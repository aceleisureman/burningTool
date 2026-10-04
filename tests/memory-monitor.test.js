'use strict';

// 回归测试：内存监控模块。
//
// 关键约束（线上踩过同类坑）：
//   1. 采集函数必须「永不抛异常」—— 它跑在 IPC handler 里，一旦抛错会让设置页整块崩掉；
//      即使不在 Electron 环境（纯 Node 测试）也必须优雅降级为 { ok:false }。
//   2. 不得在模块加载期就 require('electron')（否则纯 Node 下 require 直接失败）。
//   3. 渲染层不得再出现「reactive 解包 ref 后又取 .value」的写法（见 MqttMessages 的历史 bug）。

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const monitor = require('../src/main/core/memory-monitor');
const PRELOAD = path.join(__dirname, '..', 'src', 'preload', 'index.js');
const CORE_IPC = path.join(__dirname, '..', 'src', 'main', 'ipc', 'register-core-ipc.js');
const COMPOSABLE = path.join(__dirname, '..', 'renderer', 'src', 'composables', 'useMemoryMonitor.js');
const SETTINGS_VIEW = path.join(__dirname, '..', 'renderer', 'src', 'views', 'SettingsView.vue');
const APP_VUE = path.join(__dirname, '..', 'renderer', 'src', 'App.vue');

const read = (p) => fs.readFileSync(p, 'utf8');

/* ── 1. 纯 Node 环境下的健壮性（本测试即运行在纯 Node 中） ───── */

test('memory-monitor: 纯 Node 下 require 不抛异常', () => {
  assert.ok(monitor && typeof monitor.collect === 'function', '应导出 collect');
  assert.ok(typeof monitor.forceGc === 'function', '应导出 forceGc');
});

test('memory-monitor: 非 Electron 环境 collect() 优雅降级而非抛错', () => {
  let r;
  assert.doesNotThrow(() => { r = monitor.collect(); }, 'collect() 绝不能抛异常');
  assert.equal(typeof r, 'object');
  // 纯 Node 下没有 electron.app → ok:false + 明确原因
  assert.equal(r.ok, false);
  assert.equal(r.error, 'electron-unavailable');
  assert.equal(typeof r.at, 'number');
});

test('memory-monitor: forceGc() 永不抛异常且返回结构化结果', () => {
  let r;
  assert.doesNotThrow(() => { r = monitor.forceGc(); });
  assert.equal(typeof r.ok, 'boolean');
  assert.equal(typeof r.note, 'string');
  if (!r.ok) assert.ok(r.hint, '失败时应给出可操作提示');
});

test('memory-monitor: 模块加载期不直接 require electron', () => {
  const src = read(path.join(__dirname, '..', 'src', 'main', 'core', 'memory-monitor.js'));
  // 顶层（非函数体内）不允许出现 require('electron')
  const topLevel = src.split('\n').filter((l) => !/^\s/.test(l) && /require\(['"]electron['"]\)/.test(l));
  assert.equal(topLevel.length, 0, 'electron 必须懒加载（放进函数内），否则纯 Node 下 require 失败');
  assert.ok(/function getApp\(/.test(src), '应有 getApp() 懒加载入口');
});

/* ── 2. 主进程 / 预加载 / IPC 接线 ───────────────────── */

test('register-core-ipc: 已注册内存监控 IPC', () => {
  const src = read(CORE_IPC);
  assert.ok(/require\(['"]\.\.\/core\/memory-monitor['"]\)/.test(src), '应引入 memory-monitor');
  assert.ok(/ipcMain\.handle\(['"]app-memory-stats['"]/.test(src), '应注册 app-memory-stats');
  assert.ok(/ipcMain\.handle\(['"]app-memory-gc['"]/.test(src), '应注册 app-memory-gc');
});

test('preload: 已暴露 memoryStats / memoryGc', () => {
  const src = read(PRELOAD);
  assert.ok(/memoryStats:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(['"]app-memory-stats['"]\)/.test(src), '应暴露 memoryStats');
  assert.ok(/memoryGc:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(['"]app-memory-gc['"]\)/.test(src), '应暴露 memoryGc');
});

/* ── 3. 渲染层接线与防回归 ─────────────────────────── */

test('useMemoryMonitor: 采样上限与定时器清理', () => {
  const src = read(COMPOSABLE);
  assert.ok(/const MAX_SAMPLES = \d+/.test(src), '应有采样上限，避免长期采样撑爆内存');
  assert.ok(/clearInterval\(timer\)/.test(src), '停止采样应清理定时器');
  assert.ok(/onBeforeUnmount\(\(\)\s*=>\s*\{\s*memStop\(\)/.test(src), '组件卸载应停止采样，防止泄漏');
  assert.ok(/performance\.memory/.test(src), '应读取渲染进程 performance.memory');
});

test('useMemoryMonitor: 导出函数名与模板用法一致（mem 前缀防冲突）', () => {
  const src = read(COMPOSABLE);
  for (const name of ['memSampleNow', 'memToggle', 'memClear', 'memCopyLog', 'memExportCsv', 'memGc', 'memSetInterval']) {
    assert.ok(new RegExp('\\b' + name + '\\b').test(src), '应导出 ' + name);
  }
  // App.vue 必须把 memory 组合式展开进 appContext，否则设置页拿不到
  assert.ok(/useMemoryMonitor/.test(read(APP_VUE)), 'App.vue 应引入 useMemoryMonitor');
  assert.ok(/\.\.\.memory\b/.test(read(APP_VUE)), 'App.vue 应把 memory 展开进 appContext');
});

test('SettingsView: 内存监控区块已接线且不自造 ref 解包错误', () => {
  const src = read(SETTINGS_VIEW);
  assert.ok(/内存监控/.test(src), '应有内存监控区块');
  assert.ok(/memLatest/.test(src) && /memLogRows/.test(src), '应绑定采样状态与日志行');
  assert.ok(/memToggle|memSampleNow/.test(src), '应绑定采样控制');
  // 历史坑：reactive 解包内层 ref 后再取 .value 会得到 undefined。
  // 只在 <template> 里检查 —— appContext 是普通对象，<script> 里写 app.memLatest.value 才是对的。
  const tplMatch = src.match(/<template>([\s\S]*?)<\/template>/);
  assert.ok(tplMatch, '应能取到 template');
  const tpl = tplMatch[1].replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(!/memLatest\.value/.test(tpl), 'memLatest 是顶层 ref，模板中已解包，不应再取 .value');
  assert.ok(!/memSamples\.value/.test(tpl), 'memSamples 是顶层 ref，模板中已解包，不应再取 .value');
});

test('dev.js: 支持 MCU_EXPOSE_GC 暴露渲染进程 gc()', () => {
  const src = read(path.join(__dirname, '..', 'scripts', 'dev.js'));
  assert.ok(/MCU_EXPOSE_GC/.test(src), 'dev.js 应支持 MCU_EXPOSE_GC');
  assert.ok(/--js-flags=--expose-gc/.test(src), '应传 --js-flags=--expose-gc');
});
