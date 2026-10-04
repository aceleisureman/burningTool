'use strict';

// 回归测试：自动更新不得阻塞主进程。
//
// 背景：更新流程（检查/下载/校验/替换）运行在 Electron 主进程，
// 之前存在几处会拖慢主程序的行为：
//   1) 下载进度每次都同步 webContents.send 推送（大包可达上百次突发）
//   2) downloadFile 里用 mkdirSync/unlinkSync/renameSync 同步 FS，阻塞事件循环
//   3) 启动检查在 whenReady 同步链路上做 DMG 探测
//   4) 渲染端手动检查时，主进程 IPC 一直挂到整个下载完成
//
// 这些测试直接读取源码，断言“已改用异步/节流实现”，防止后续回退。

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const UPDATER_SRC = path.join(__dirname, '..', 'src', 'main', 'core', 'updater.js');
const CORE_IPC_SRC = path.join(__dirname, '..', 'src', 'main', 'ipc', 'register-core-ipc.js');
const USE_UPDATE_SRC = path.join(__dirname, '..', 'renderer', 'src', 'composables', 'useUpdate.js');

const updaterSource = fs.readFileSync(UPDATER_SRC, 'utf8');
const coreIpcSource = fs.readFileSync(CORE_IPC_SRC, 'utf8');
const useUpdateSource = fs.readFileSync(USE_UPDATE_SRC, 'utf8');

/* ── 1. 源码层面的异步约束 ───────────────────────────── */

test('updater.js: downloadFile 不再使用同步 FS 调用', () => {
  // 截取 downloadFile 函数体，避免误伤别处（如退出期一次性写入 sh 脚本）
  const start = updaterSource.indexOf('function downloadFile(');
  assert.ok(start > -1, '应能找到 downloadFile');
  const end = updaterSource.indexOf('\nfunction ', start + 10);
  const body = updaterSource.slice(start, end > -1 ? end : undefined);
  assert.ok(!/mkdirSync|unlinkSync|renameSync/.test(body), 'downloadFile 不应再有同步 FS');
  assert.ok(/fsMkdirp|fsRename|fsUnlinkQuiet/.test(body), 'downloadFile 应改用异步 FS 助手');
});

test('updater.js: 提供异步 FS 助手', () => {
  for (const fn of ['fsMkdirp', 'fsUnlinkQuiet', 'fsRename', 'fsStatOrNull']) {
    assert.ok(updaterSource.includes('function ' + fn), '缺少异步助手 ' + fn);
  }
  assert.ok(/fs\.promises\.(mkdir|unlink|rename|stat|writeFile|chmod)/.test(updaterSource), '应使用 fs.promises');
});

test('updater.js: mac 下载/安装路径不再用同步 FS', () => {
  assert.ok(!/fs\.existsSync\(dest\)/.test(updaterSource), 'mac 目标文件存在性检查应异步');
  assert.ok(!/fs\.accessSync\(/.test(updaterSource), 'mac 写权限探测应异步');
  assert.ok(!/fs\.unlinkSync\(dest\)/.test(updaterSource), 'mac 清理目标文件应异步');
});

test('updater.js: 关键状态用 immediate 立即推送，进度用节流', () => {
  assert.ok(updaterSource.includes('UPDATE_BROADCAST_MS'), '应定义广播节流窗口');
  assert.ok(/function scheduleBroadcast\(/.test(updaterSource), '应有 scheduleBroadcast');
  assert.ok(/function broadcastNow\(/.test(updaterSource), '应有 broadcastNow（立即推送）');
  // completed / installing / error 应走 immediate
  assert.ok(/status: 'downloaded'[^}]*\}\s*,\s*\{\s*immediate:\s*true\s*\}/.test(updaterSource),
    '下载完成应立即推送');
  assert.ok(/status: 'error'[^}]*\}\s*,\s*\{\s*immediate:\s*true\s*\}/.test(updaterSource),
    '错误状态应立即推送');
  // download-progress 不应 immediate
  const progressBlock = updaterSource.slice(
    updaterSource.indexOf("u.on('download-progress'"),
    updaterSource.indexOf("u.on('update-downloaded'")
  );
  assert.ok(progressBlock.length > 0, '应能找到 download-progress 监听');
  assert.ok(!/immediate:\s*true/.test(progressBlock), '下载进度应走节流而非立即推送');
});

test('updater.js: 启动检查不阻塞 whenReady，且定时器 unref', () => {
  assert.ok(/function checkOnStartup\(/.test(updaterSource), '应有 checkOnStartup');
  // DMG 探测应移入延迟回调，而不是 checkOnStartup 的同步头部
  const start = updaterSource.indexOf('function checkOnStartup(');
  const end = updaterSource.indexOf('\nfunction ', start + 10);
  const body = updaterSource.slice(start, end > -1 ? end : undefined);
  const setTimeoutIdx = body.indexOf('setTimeout(');
  const dmgIdx = body.indexOf('isRunningFromDmg()');
  assert.ok(setTimeoutIdx > -1, '启动检查应使用 setTimeout 延迟');
  assert.ok(dmgIdx > setTimeoutIdx, 'DMG 探测应位于延迟回调内');
  assert.ok(/\.unref\(\)/.test(body), '启动检查定时器应 unref，避免阻止退出');
});

/* ── 2. IPC 契约：立即 ack ───────────────────────────── */

test('register-core-ipc.js: update-check 立即返回 ack，不挂起到下载完成', () => {
  const start = coreIpcSource.indexOf("ipcMain.handle('update-check'");
  assert.ok(start > -1, '应能找到 update-check');
  const end = coreIpcSource.indexOf("ipcMain.handle('update-status'", start);
  const block = coreIpcSource.slice(start, end > -1 ? end : undefined);
  // 不应直接 return updater.checkNow()（返回 promise 会等待整轮下载）
  assert.ok(!/=>\s*updater\.checkNow\(\)\s*;?\s*\}/.test(block),
    'update-check 不应直接 await/return checkNow()');
  assert.ok(/started|already-checking/.test(block), '应立即返回受理 ack');
  assert.ok(/\.catch\(/.test(block), '后台检查应有 catch 兜底');
  assert.ok(/updateCheckInFlight/.test(block), '应有在途标记避免并发重复检查');
});

/* ── 3. 渲染端：终态才停轮询 ──────────────────────────── */

test('useUpdate.js: 立即 ack 后不提前停轮询', () => {
  // startPoll 内的停止条件：终态才停，checking/downloading 继续跟踪
  const start = useUpdateSource.indexOf('function startPoll(');
  const end = useUpdateSource.indexOf('function stopPoll(', start);
  const pollBody = useUpdateSource.slice(start, end > -1 ? end : undefined);
  const stopLine = pollBody.split('\n').find((l) => l.includes('.includes(s.status)'));
  assert.ok(stopLine, '应能找到轮询的停止条件');
  // 停止条件不得包含 checking（否则立即 ack 后会过早停轮询）
  assert.ok(!/checking/.test(stopLine), '轮询不应在 checking 状态停止');
  assert.ok(/latest[\s\S]*downloaded[\s\S]*error/.test(stopLine), '轮询应在终态停止');
});

/* ── 4. 节流逻辑的纯函数复现 ─────────────────────────── */

// 复现 updater.js 的版本号 + 节流窗口合并算法
function makeCoalescer(flushDelayMs) {
  let stateVersion = 0;
  let broadcastVersion = 0;
  let emits = 0;
  let pending = null;
  const flush = () => {
    pending = null;
    if (broadcastVersion === stateVersion) return;
    broadcastVersion = stateVersion;
    emits++;
  };
  const schedule = () => {
    if (pending) return;
    pending = { fireAt: Date.now() + flushDelayMs };
  };
  return {
    set(immediate) {
      stateVersion++;
      if (immediate) {
        pending = null;
        broadcastVersion = stateVersion;
        emits++;
      } else {
        schedule();
      }
    },
    tick(now) {
      if (pending && now >= pending.fireAt) flush();
    },
    get emits() { return emits; },
    get pending() { return !!pending; }
  };
}

test('节流合并：一窗内 N 次进度更新只推送一次', () => {
  const c = makeCoalescer(150);
  // 模拟 100 次下载进度（非 immediate）
  for (let i = 0; i < 100; i++) c.set(false);
  assert.equal(c.emits, 0, '窗口未到不应推送');
  c.tick(Date.now() + 200);
  assert.equal(c.emits, 1, '整窗合并后只推送一次');
  assert.equal(c.pending, false, '推送后清空挂起');
});

test('节流合并：关键状态（immediate）立刻推送并清空挂起', () => {
  const c = makeCoalescer(150);
  c.set(false);              // 有一次挂起的进度推送
  assert.equal(c.emits, 0);
  c.set(true);               // 完成/安装等关键状态
  assert.equal(c.emits, 1, 'immediate 应立即推送');
  assert.equal(c.pending, false, 'immediate 应清空挂起的节流定时器');
  c.tick(Date.now() + 500);
  assert.equal(c.emits, 1, '不应再重复推送');
});

test('节流合并：无新变化时不重复推送', () => {
  const c = makeCoalescer(150);
  c.set(false);
  c.tick(Date.now() + 200);
  assert.equal(c.emits, 1);
  c.tick(Date.now() + 400);   // 再次到期但没有新版本
  assert.equal(c.emits, 1, '无变化不应重复推送');
});

/* ── 5. 异步 FS 助手语义 ─────────────────────────────── */

test('异步 FS 助手：fsRename 在目标存在时先删再改名', async () => {
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-async-'));
  try {
    // 复现 fsRename
    async function fsUnlinkQuiet(p) { try { await fs.promises.unlink(p); } catch {} }
    async function fsRename(from, to) {
      try { await fs.promises.rename(from, to); return; }
      catch (err) {
        if (err && (err.code === 'EEXIST' || err.code === 'EPERM')) {
          await fsUnlinkQuiet(to);
          await fs.promises.rename(from, to);
          return;
        }
        throw err;
      }
    }
    const target = path.join(dir, 'app.exe');
    const tmp = target + '.part';
    fs.writeFileSync(target, 'old');
    fs.writeFileSync(tmp, 'new');
    await fsRename(tmp, target);
    assert.equal(fs.readFileSync(target, 'utf8'), 'new', '应覆盖为临时文件内容');
    assert.ok(!fs.existsSync(tmp), '临时文件应已消失');
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

test('异步 FS 助手：fsStatOrNull 对不存在路径返回 null', async () => {
  const missing = path.join(__dirname, '__no_such_file_' + Date.now() + '.__x');
  const p = fs.promises.stat(missing).catch(() => null);
  assert.equal(await p, null);
});
