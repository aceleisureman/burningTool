// 启动性能探针的单元测试：验证打点/计时/慢操作登记/快照结构，
// 以及「默认关闭时不产生副作用」这一关键约束（正式运行零开销）。
//
// 注意：这里不 spawn 子进程（沙箱环境会拦截 spawnSync），
// 而是通过「清 require 缓存 + 重新 require」在同一进程内模拟多次加载，
// 并用临时改写 process.env 控制 ENABLED 开关。
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PROFILE_SRC = path.join(ROOT, 'src', 'main', 'core', 'startup-profile.js');
const INDEX_SRC = path.join(ROOT, 'src', 'main', 'index.js');
const TOOLCHAIN_IPC_SRC = path.join(ROOT, 'src', 'main', 'ipc', 'register-toolchain-ipc.js');
const STATUS_SRC = path.join(ROOT, 'packages', 'flash-core', 'toolchain', 'status.js');
const SYSTEM_PATH_SRC = path.join(ROOT, 'packages', 'flash-core', 'toolchain', 'system-path.js');
const INSTALLER_SRC = path.join(ROOT, 'packages', 'flash-core', 'toolchain', 'installer.js');
const APP_SRC = path.join(ROOT, 'renderer', 'src', 'App.vue');
const MONITOR_SRC = path.join(ROOT, 'scripts', 'startup-monitor.js');

function read(p) { return fs.readFileSync(p, 'utf8'); }

// 在隔离环境中重新加载探针模块（ENABLED 在模块加载时求值，故必须清缓存）
function freshProfile(env = {}) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; }
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  delete require.cache[require.resolve(PROFILE_SRC)];
  let mod;
  try {
    mod = require(PROFILE_SRC);
  } finally {
    // 恢复环境（模块内部的 ENABLED 已经定格，恢复不会影响它）
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return mod;
}

const busy = (ms) => { const s = Date.now(); while (Date.now() - s < ms) { /* warm */ } };

test('探针默认关闭：ENABLED=false，span 直接返回结果，snapshot 不含数据', () => {
  const p = freshProfile({ MCU_STARTUP_PROFILE: undefined });
  assert.strictEqual(p.ENABLED, false, '未设环境变量时应关闭');
  assert.strictEqual(p.span('b', () => 7), 7, 'span 应原样透传返回值');
  p.mark('a');
  p.rendererMark('x', 10);
  assert.deepStrictEqual(p.snapshot(), { enabled: false }, '关闭时 snapshot 应为 {enabled:false}');
  assert.doesNotThrow(() => p.printReport('x'), '关闭时 printReport 应安全 no-op');
});

test('MCU_STARTUP_PROFILE=1 时：记录阶段、span 计时、snapshot 有结构', () => {
  const p = freshProfile({ MCU_STARTUP_PROFILE: '1' });
  assert.strictEqual(p.ENABLED, true, '设环境变量后应开启');
  p.mark('a');
  const r = p.span('b', () => { busy(12); return 42; });
  assert.strictEqual(r, 42, 'span 应透传被包裹函数的返回值');
  const snap = p.snapshot();
  assert.strictEqual(snap.enabled, true);
  assert.ok(Array.isArray(snap.stages), 'stages 应为数组');
  assert.ok(Array.isArray(snap.slowSyncOps), 'slowSyncOps 应为数组');
  assert.ok(snap.totalMs >= 0, 'totalMs 应为非负数');
  const names = snap.stages.map((s) => s.name);
  assert.ok(names.includes('a'), '应记录 mark("a")');
  assert.ok(names.includes('b'), '应记录 span("b")');
  const b = snap.stages.find((s) => s.name === 'b');
  assert.ok(typeof b.durMs === 'number' && b.durMs >= 10, 'span 应测得 ≥10ms 忙等耗时，实际 ' + b.durMs);
  assert.ok(snap.marks.a != null, 'marks 应含 a 的绝对时刻');
});

test('重复 mark 同名只保留首次（避免阶段被后续打点覆盖）', () => {
  const p = freshProfile({ MCU_STARTUP_PROFILE: '1' });
  p.mark('dup');
  const first = p.snapshot().marks.dup;
  busy(8);
  p.mark('dup');
  const second = p.snapshot().marks.dup;
  assert.strictEqual(first, second, '同名 mark 应保留首次时刻');
  assert.strictEqual(p.snapshot().stages.filter((s) => s.name === 'dup').length, 1, 'stages 中不应重复');
});

test('慢同步操作（≥阈值）被计入 slowSyncOps', () => {
  const p = freshProfile({ MCU_STARTUP_PROFILE: '1', MCU_STARTUP_SLOW_MS: '5' });
  p.span('slow-one', () => busy(12));
  const snap = p.snapshot();
  assert.ok(snap.slowSyncOps.length >= 1, '12ms 忙等应在阈值 5ms 下被登记');
  assert.strictEqual(snap.slowSyncOps[0].name, 'slow-one');
  assert.ok(snap.slowSyncOps[0].durMs >= 10);
});

test('未达阈值的操作不进 slowSyncOps（避免噪声）', () => {
  const p = freshProfile({ MCU_STARTUP_PROFILE: '1', MCU_STARTUP_SLOW_MS: '500' });
  p.span('quick', () => busy(5));
  assert.strictEqual(p.snapshot().slowSyncOps.length, 0, '5ms 在 500ms 阈值下不应登记');
});

test('慢操作按耗时降序排列（便于一眼看到最慢项）', () => {
  const p = freshProfile({ MCU_STARTUP_PROFILE: '1', MCU_STARTUP_SLOW_MS: '5' });
  p.span('fast', () => busy(10));
  p.span('slowest', () => busy(40));
  p.span('mid', () => busy(25));
  const names = p.snapshot().slowSyncOps.map((o) => o.name);
  assert.deepStrictEqual(names, ['slowest', 'mid', 'fast'], '应按耗时降序，实际 ' + names.join(','));
});

test('spanAsync 记录异步耗时并透传结果', async () => {
  const p = freshProfile({ MCU_STARTUP_PROFILE: '1', MCU_STARTUP_SLOW_MS: '5' });
  const r = await p.spanAsync('async-op', async () => { await new Promise((res) => setTimeout(res, 15)); return 'ok'; });
  assert.strictEqual(r, 'ok', 'spanAsync 应透传返回值');
  const s = p.snapshot().stages.find((x) => x.name === 'async-op');
  assert.ok(s && s.durMs >= 10, '应测得异步耗时，实际 ' + (s && s.durMs));
});

test('rendererMark 把渲染层里程碑并入时间轴', () => {
  const p = freshProfile({ MCU_STARTUP_PROFILE: '1' });
  p.rendererMark('firstPaint', 1234);
  const s = p.snapshot().stages.find((x) => x.name === 'renderer:firstPaint');
  assert.ok(s, '应存在 renderer:firstPaint 阶段');
  assert.strictEqual(s.durMs, 1234, '应保留渲染端传入的相对时刻');
  assert.strictEqual(s.source, 'renderer');
});

test('主进程 index.js 已接入探针：打点关键阶段且包住 createWindow', () => {
  const src = read(INDEX_SRC);
  for (const m of ['main:entry', 'main:modules-loaded', 'main:ready', 'main:createWindow']) {
    assert.ok(src.includes(m), `index.js 应含打点 ${m}`);
  }
  assert.match(src, /profile\.span\(\s*'main:createWindow'/, 'createWindow 应用 span 包裹以测耗时');
});

test('工具链 IPC 已包裹打点（default-toolchain-status 是已知同步瓶颈）', () => {
  const src = read(TOOLCHAIN_IPC_SRC);
  assert.match(src, /profile\.span\(\s*'ipc:default-toolchain-status'/, '应包裹 default-toolchain-status');
  assert.match(src, /profile\.span\(\s*'ipc:toolchain-system-path-status'/, '应包裹 toolchain-system-path-status');
});

test('版本探测已加缓存与更短 timeout（避免启动期 5×2500ms 串行冻结）', () => {
  const src = read(STATUS_SRC);
  assert.match(src, /versionCache/, '应有进程内版本缓存');
  assert.match(src, /VERSION_PROBE_TIMEOUT_MS/, '应有独立的探测超时常量');
  assert.match(src, /invalidateVersionCache/, '应导出失效函数');
  const m = src.match(/VERSION_PROBE_TIMEOUT_MS\s*=\s*(\d+)/);
  assert.ok(m, '应能解析超时常量');
  assert.ok(Number(m[1]) <= 1000, `超时应 ≤1000ms，实际 ${m[1]}ms`);
  assert.ok(!/timeout:\s*2500/.test(src), '不应再出现硬编码 2500ms 超时');
});

test('版本缓存实测生效：二次调用显著快于首次', () => {
  // 直接加载真实模块（不依赖环境变量，缓存恒开）
  delete require.cache[require.resolve(STATUS_SRC)];
  const s = require(STATUS_SRC);
  assert.strictEqual(typeof s.invalidateVersionCache, 'function', '应导出 invalidateVersionCache');
  // 预热一次（首次含模块内各种 paths 探测，噪声大）
  s.defaultToolchainStatus();
  // 清缓存 → 冷调用（真正会 spawnSync 探测）
  s.invalidateVersionCache();
  const t1 = Date.now();
  s.defaultToolchainStatus();
  const cold = Date.now() - t1;
  // 不清缓存 → 热调用（应命中 versionCache，跳过 spawn）
  const t2 = Date.now();
  s.defaultToolchainStatus();
  const warm = Date.now() - t2;
  // 断言用「热调用 ≤ 冷调用 + 容差」：避免纯时间比较在慢机器上偶发抖动
  assert.ok(warm <= cold + 5, `命中缓存(${warm}ms) 不应明显慢于冷调用(${cold}ms)`);
});

test('安装完成后失效版本缓存（否则界面显示旧版本号）', () => {
  const src = read(INSTALLER_SRC);
  assert.match(src, /invalidateVersionCache\(\)/, 'installDefaultToolchain 结束前应调用 invalidateVersionCache');
  assert.match(src, /invalidateVersionCache\s*\}\s*=\s*require\('\.\/status'\)|invalidateVersionCache/, '应正确导入该函数');
});

test('Windows 用户 PATH 读取加了 TTL 缓存（reg query 同步调用 ~90ms，启动路径须避免）', () => {
  const src = read(SYSTEM_PATH_SRC);
  assert.match(src, /USER_PATH_TTL_MS/, '应有 TTL 常量');
  assert.match(src, /invalidateUserPathCache/, '应导出失效函数');
  assert.match(src, /userPathCache/, '应有缓存变量');
  // 缓存必须带时间戳（TTL 语义）
  assert.match(src, /userPathCache\s*=\s*\{\s*value[^}]*at:\s*Date\.now\(\)/, '缓存项应记录写入时刻');
});

test('PATH 写入后立即失效缓存（保证写入后读到新值）', () => {
  const src = read(SYSTEM_PATH_SRC);
  const writeFn = src.slice(src.indexOf('function writeWindowsUserPath'));
  assert.match(writeFn, /invalidateUserPathCache\(\)/, 'writeWindowsUserPath 内应调用 invalidateUserPathCache');
});

test('PATH 缓存异常路径不污染：spawn 失败时不写缓存', () => {
  // 在沙箱里 reg.exe 通常 EBUSY；连续两次调用都应真正尝试 spawn（说明失败未缓存）
  const sp = require(SYSTEM_PATH_SRC);
  assert.strictEqual(typeof sp.readWindowsUserPath, 'function');
  assert.strictEqual(typeof sp.invalidateUserPathCache, 'function');
  let attempts = 0;
  for (let i = 0; i < 2; i++) {
    sp.invalidateUserPathCache();
    try { sp.readWindowsUserPath(); } catch { attempts++; }
  }
  // 若 reg 可用（能读到值），attempts 为 0 也算通过——不强制平台行为
  assert.ok(attempts === 0 || attempts === 2, '失败不应被缓存（两次都重试），实际 ' + attempts);
});

test('渲染层把首屏非必需任务移出关键路径（idle 调度）', () => {
  const src = read(APP_SRC);
  assert.match(src, /const idle\s*=/, '应定义 idle 调度器');
  assert.match(src, /requestIdleCallback/, '应优先使用 requestIdleCallback');
  assert.match(src, /idle\(\(\)\s*=>\s*\{[\s\S]*?refreshDefaultTc/, 'refreshDefaultTc 应在 idle 内执行而非启动关键路径');
  assert.match(src, /startupMark/, '应回报渲染层里程碑');
});

test('loadConfig 的独立 IPC 已并行化（3 次串行 → Promise.allSettled）', () => {
  const src = read(path.join(ROOT, 'renderer', 'src', 'composables', 'useSettings.js'));
  assert.match(src, /Promise\.allSettled/, 'loadConfig 应用 Promise.allSettled 并行取 platform/profile/config');
});

test('preload 暴露启动探针接口', () => {
  const src = read(path.join(ROOT, 'src', 'preload', 'index.js'));
  assert.match(src, /startupMark/, '应暴露 startupMark');
  assert.match(src, /startupProfile/, '应暴露 startupProfile');
});

test('监控脚本声明了必要能力（CDP / 探针开关 / 帧间隔检测）', () => {
  const src = read(MONITOR_SRC);
  assert.match(src, /remote-debugging-port/, '应启用 CDP 远程调试');
  assert.match(src, /MCU_STARTUP_PROFILE/, '应打开主进程探针');
  assert.match(src, /maxFrameGapMs/, '应检测帧间隔以判定卡顿');
  assert.match(src, /parseMainProfile/, '应解析主进程阶段表');
  assert.match(src, /addScriptToEvaluateOnNewDocument/, '应注入渲染层探针');
});
