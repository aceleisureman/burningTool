#!/usr/bin/env node
// 启动性能监控：量化「从进程启动到首屏可见」每一段的耗时，定位卡顿来源。
//
// 为什么需要它：截图里「窗口边框已显示、内容区全白」是典型的「主窗口创建了，
// 但渲染层还没完成首次绘制」——即白屏期。肉眼只能看到「卡」，看不到卡在哪一段：
//   - 主进程 require 链 + 同步探测（工具链 spawnSync）→ 阻塞 whenReady
//   - Vite dev server 冷启动 / 依赖重新预构建
//   - 渲染层 JS 解析 + Vue 挂载
//   - 首帧布局/字体加载
// 本脚本用 CDP（Chrome DevTools Protocol）拿到真实的时间线打点，输出分段报告。
//
// 用法：
//   node scripts/startup-monitor.js                # 默认启动并监控一次
//   node scripts/startup-monitor.js --runs 3       # 连续 3 次取中位数
//   node scripts/startup-monitor.js --no-gpu       # 软件渲染（等同 MCU_DISABLE_GPU=1）
//   node scripts/startup-monitor.js --json out.json
//
// 退出码：0 = 完成监控；非 0 = 启动失败。
'use strict';

const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');
const PORT = 5173;
const DEV_URL = `http://localhost:${PORT}`;

/* ── 命令行参数 ─────────────────────────────────────── */
function parseArgs(argv) {
  const opts = { runs: 1, noGpu: false, json: '', keepOpen: false, timeoutMs: 60000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runs') opts.runs = Math.max(1, parseInt(argv[++i], 10) || 1);
    else if (a === '--no-gpu' || a === '--nogpu') opts.noGpu = true;
    else if (a === '--json') opts.json = argv[++i] || 'startup-report.json';
    else if (a === '--keep-open') opts.keepOpen = true;
    else if (a === '--timeout') opts.timeoutMs = Math.max(5000, parseInt(argv[++i], 10) || 60000);
    else if (a === '-h' || a === '--help') { printHelp(); process.exit(0); }
  }
  return opts;
}

function printHelp() {
  console.log(`启动性能监控

用法: node scripts/startup-monitor.js [选项]

选项:
  --runs <n>      重复 n 次取中位数（默认 1）
  --no-gpu        软件渲染启动（等同 MCU_DISABLE_GPU=1，规避 GPU 崩溃环境）
  --json <file>   把结果写入 JSON 文件
  --keep-open     监控结束后不关闭应用
  --timeout <ms>  单次启动超时（默认 60000）
  -h, --help      显示帮助`);
}

/* ── 小工具 ─────────────────────────────────────────── */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Number(process.hrtime.bigint()) / 1e6;

function fmt(ms) {
  if (ms == null || !Number.isFinite(ms)) return '   n/a';
  return `${ms.toFixed(0).padStart(5)}ms`;
}

function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function electronBin() {
  if (process.platform === 'darwin') return path.join(ELECTRON_DIST, 'Electron.app', 'Contents', 'MacOS', 'Electron');
  if (process.platform === 'win32') return path.join(ELECTRON_DIST, 'electron.exe');
  return path.join(ELECTRON_DIST, 'electron');
}

function portInUse(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => { s.destroy(); resolve(false); });
    setTimeout(() => { try { s.destroy(); } catch {} resolve(false); }, 800);
  });
}

/* ── CDP 极简客户端（不依赖任何第三方包）─────────────────
 * Electron 支持 --remote-debugging-port，暴露 /json 列表 + websocket。
 * Node 22 自带全局 WebSocket，直接用即可。
 */
async function fetchJson(url, timeoutMs = 3000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

class CdpSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.ws = null;
    this.ready = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      const failTimer = setTimeout(() => reject(new Error('CDP websocket 连接超时')), 5000);
      ws.onopen = () => {
        clearTimeout(failTimer);
        this.ready = true;
        resolve();
      };
      ws.onerror = (e) => { clearTimeout(failTimer); reject(new Error('CDP websocket 错误: ' + (e && e.message ? e.message : 'unknown'))); };
      ws.onclose = () => { this.ready = false; };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.id != null && this.pending.has(msg.id)) {
          const { resolve: res, reject: rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rej(new Error(msg.error.message || 'CDP error'));
          else res(msg.result);
        } else if (msg.method) {
          const list = this.handlers.get(msg.method);
          if (list) for (const h of list) { try { h(msg.params, msg.sessionId); } catch {} }
        }
      };
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      try { this.ws.send(JSON.stringify(payload)); }
      catch (e) { this.pending.delete(id); reject(e); return; }
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP ${method} 超时`)); }
      }, 8000);
    });
  }

  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(handler);
  }

  close() { try { this.ws && this.ws.close(); } catch {} }
}

/* ── 单次启动测量 ───────────────────────────────────── */
async function measureOnce(opts, runIndex) {
  const t0 = now();
  const marks = {};
  const mark = (name) => { marks[name] = now() - t0; };

  const cleanupFns = [];
  const cleanup = () => { while (cleanupFns.length) { try { cleanupFns.pop()(); } catch {} } };

  // 1) Vite dev server（与 scripts/dev.js 行为一致）
  mark('processStart');
  const vitePkg = require.resolve('vite/package.json');
  const viteBin = path.join(path.dirname(vitePkg), 'bin', 'vite.js');
  mark('viteResolve');
  const vite = spawn(process.execPath, [viteBin, '--host', '127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT });
  cleanupFns.push(() => { try { vite.kill(); } catch {} });

  let viteOut = '';
  vite.stdout.on('data', (d) => { viteOut += d.toString(); });
  vite.stderr.on('data', (d) => { viteOut += d.toString(); });

  // Vite ready 的两种标志：日志里出现 "ready in"，或端口可连
  let viteReadyMarked = false;
  const markViteReady = () => {
    if (viteReadyMarked) return;
    viteReadyMarked = true;
    mark('viteReady');
  };
  vite.stdout.on('data', (d) => { if (/ready in/i.test(d.toString())) markViteReady(); });

  const viteWaitStart = now();
  let viteReady = false;
  for (let i = 0; i < 400; i++) {
    if (await portInUse(PORT)) { viteReady = true; break; }
    if (vite.exitCode != null) break;
    await sleep(100);
  }
  if (!viteReady) {
    cleanup();
    const err = new Error(`Vite dev server 未就绪（端口 ${PORT}），日志：\n${viteOut.slice(-800)}`);
    err.viteOut = viteOut;
    throw err;
  }
  marks.vitePortOpen = now() - t0;
  if (!viteReadyMarked) markViteReady();
  marks.vitePortWaitMs = now() - viteWaitStart;

  // 2) Electron + 远程调试端口
  const bin = electronBin();
  if (!fs.existsSync(bin)) { cleanup(); throw new Error('Electron 可执行文件不存在: ' + bin); }

  const extraArgs = [];
  if (opts.noGpu) extraArgs.push('--disable-gpu', '--disable-gpu-compositing', '--in-process-gpu', '--no-sandbox');
  // 远程调试端口：0 让系统分配，但我们拿不到实际端口，所以固定一个较冷门的端口
  const dbgPort = 9222 + (runIndex % 50);
  const electron = spawn(bin, ['.', `--remote-debugging-port=${dbgPort}`, ...extraArgs], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: ROOT,
    env: (() => {
      const e = { ...process.env, VITE_DEV_SERVER_URL: DEV_URL };
      delete e.ELECTRON_RUN_AS_NODE;
      // 打开主进程侧探针：渲染层回报 firstPaint 时会在 stdout 打印完整启动报告
      e.MCU_STARTUP_PROFILE = '1';
      return e;
    })()
  });
  cleanupFns.push(() => { try { electron.kill(); } catch {} });
  // 子进程树兜底清理（Windows 上 Electron 会有多个子进程）
  cleanupFns.push(() => {
    if (process.platform === 'win32' && electron.pid) {
      try { spawn('taskkill', ['/PID', String(electron.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    }
  });

  let elOut = '';
  let elErr = '';
  electron.stdout.on('data', (d) => { elOut += d.toString(); });
  electron.stderr.on('data', (d) => { elErr += d.toString(); });

  // 3) 等 CDP 端点可用 → 拿到 target 列表
  let targets = null;
  for (let i = 0; i < 300; i++) {
    try {
      targets = await fetchJson(`http://127.0.0.1:${dbgPort}/json/list`, 1000);
      if (Array.isArray(targets) && targets.length) break;
    } catch {}
    if (electron.exitCode != null) break;
    await sleep(100);
  }
  mark('cdpList');
  if (!Array.isArray(targets) || !targets.length) {
    cleanup();
    const reason = await diagnoseElectronFailure(elOut, elErr);
    throw new Error(reason);
  }

  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || targets.find((t) => t.webSocketDebuggerUrl);
  if (!page) { cleanup(); throw new Error('未找到可调试的页面 target'); }

  const cdp = new CdpSession(page.webSocketDebuggerUrl);
  cleanupFns.push(() => cdp.close());
  await cdp.connect();

  // 4) 采集渲染层时间线
  const evalExpr = (expr, awaitPromise = false) => cdp.send('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise
  }).then((r) => (r && r.result ? r.result.value : undefined)).catch(() => undefined);

  // 关键：CDP 附着常在页面已加载之后，Page.lifecycleEvent 会漏。
  // 改为「主动从渲染层 performance 时间线读回」——这是真实、可靠的来源。
  // 同时注入一个探针：记录 Vue 挂载与首屏可见的 process-relative 时刻。
  // 探针必须在页面脚本前执行；这里用 addScriptToEvaluateOnNewDocument 之后强制 reload 一次，
  // 从而拿到「从导航开始」的干净时间线。
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.setLifecycleEventsEnabled', { enabled: true });

  const timeline = [];
  let firstPaint = null;
  let firstContentfulPaint = null;
  let domContentLoaded = null;
  let loadEvent = null;
  let mountDone = null;
  let appElPopulated = null;

  cdp.on('Page.lifecycleEvent', (p) => {
    if (!p) return;
    const at = now() - t0;
    timeline.push({ name: p.name, at });
    if (p.name === 'firstPaint' && firstPaint == null) firstPaint = at;
    if (p.name === 'firstContentfulPaint' && firstContentfulPaint == null) firstContentfulPaint = at;
    if (p.name === 'DOMContentLoaded' && domContentLoaded == null) domContentLoaded = at;
    if (p.name === 'load' && loadEvent == null) loadEvent = at;
  });

  // 注入探针：Vue 挂载完成 / 首屏布局完成 时打 performance.mark，
  // 并记录 #app 子节点出现时刻。探针自带重试（Vue 挂载时机不定）。
  const PROBE = `(() => {
    if (window.__startupProbeInstalled) return;
    window.__startupProbeInstalled = true;
    const t0 = performance.now();
    window.__startupProbe = { navStart: 0, marks: {} };
    const done = (name) => {
      if (window.__startupProbe.marks[name] != null) return;
      window.__startupProbe.marks[name] = Math.round(performance.now() - t0);
      try { performance.mark('mcu:' + name); } catch (e) {}
    };
    const tick = () => {
      const el = document.getElementById('app');
      if (el && el.children.length > 0) done('appMounted');
      const nav = document.querySelector('.app-nav');
      const main = document.querySelector('.app-main');
      if (nav && main) {
        const r = main.getBoundingClientRect();
        if (r.height > 0) { done('uiVisible'); done('probeDone'); return; }
      }
      if (window.__startupProbe.marks.probeDone == null) requestAnimationFrame(tick);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick);
    requestAnimationFrame(tick);
  })();`;

  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
  // 强制重载一次，让探针从导航起点开始计时（时间线干净、可复现）
  mark('beforeReload');
  await cdp.send('Page.reload', { ignoreCache: false });

  // 轮询直到探针报出 uiVisible 或超时
  const mountWaitStart = now();
  const deadline = now() + opts.timeoutMs;
  let probe = null;
  while (now() < deadline) {
    const snap = await evalExpr(`(() => {
      const el = document.getElementById('app');
      const nav = document.querySelector('.app-nav');
      const main = document.querySelector('.app-main');
      const p = window.__startupProbe || null;
      return {
        readyState: document.readyState,
        appChildren: el ? el.children.length : -1,
        hasNav: !!nav,
        hasMain: !!main,
        navH: nav ? Math.round(nav.getBoundingClientRect().height) : 0,
        mainH: main ? Math.round(main.getBoundingClientRect().height) : 0,
        probe: p ? { marks: { ...p.marks } } : null,
        probeInstalled: !!window.__startupProbeInstalled
      };
    })()`);
    if (snap) {
      probe = snap.probe;
      if (snap.readyState === 'complete' && loadEvent == null) loadEvent = now() - t0;
      if (snap.appChildren > 0 && appElPopulated == null) { appElPopulated = now() - t0; mark('appPopulated'); }
      if (snap.hasNav && snap.hasMain && snap.mainH > 0 && mountDone == null) {
        mountDone = now() - t0;
        mark('uiVisible');
        // 再等一小会，让探针把 uiVisible 写全
        await sleep(150);
        break;
      }
    }
    await sleep(40);
  }
  marks.mountPollMs = now() - mountWaitStart;

  // 5) 从渲染层读回权威时间线（含探针 marks 与 PerformancePaintTiming）
  const perf = await evalExpr(`(() => {
    try {
      const nav = performance.getEntriesByType('navigation')[0] || {};
      const paints = performance.getEntriesByType('paint') || [];
      const out = {
        domContentLoaded: nav.domContentLoadedEventEnd,
        load: nav.loadEventEnd,
        responseEnd: nav.responseEnd,
        domInteractive: nav.domInteractive,
        fetchStart: nav.fetchStart,
        startTime: nav.startTime,
        probe: window.__startupProbe ? window.__startupProbe.marks : null
      };
      for (const p of paints) {
        if (p.name === 'first-paint') out.firstPaint = p.startTime;
        if (p.name === 'first-contentful-paint') out.firstContentfulPaint = p.startTime;
      }
      out.marks = (performance.getEntriesByType('mark') || []).map((m) => ({ name: m.name, startTime: Math.round(m.startTime) }));
      return out;
    } catch (e) { return null; }
  })()`);

  // 6) 启动期 IPC 探测：工具链状态是已知的同步瓶颈候选
  const ipcProbe = await evalExpr(`(async () => {
    const out = {};
    for (const [key, fn] of [
      ['toolchainStatus', () => window.api.toolchainStatus()],
      ['defaultToolchainStatus', () => window.api.defaultToolchainStatus()],
      ['getConfig', () => window.api.getConfig()]
    ]) {
      const t = performance.now();
      try { await fn(); out[key + 'Ms'] = Math.round(performance.now() - t); }
      catch (e) { out[key + 'Error'] = String(e); }
    }
    return out;
  })()`, true);

  // 7) 阻塞检测：主进程被同步任务卡住时，渲染层 rAF 会出现长间隔。
  //    采样 2 秒内 rAF 间隔，报出最大帧间隔（>100ms 即为明显卡顿）。
  const frameProbe = await evalExpr(`(async () => {
    const gaps = [];
    let last = performance.now();
    const start = last;
    await new Promise((resolve) => {
      const step = () => {
        const t = performance.now();
        gaps.push(Math.round(t - last));
        last = t;
        if (t - start > 2000) resolve();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    gaps.sort((a, b) => b - a);
    return { maxFrameGapMs: gaps[0], p95FrameGapMs: gaps[Math.floor(gaps.length * 0.05)] || gaps[0], frames: gaps.length };
  })()`, true);

  const result = {
    run: runIndex,
    marks,
    timeline,
    firstPaint,
    firstContentfulPaint,
    domContentLoaded,
    loadEvent,
    mountDone,
    appElPopulated,
    perf,
    ipcProbe,
    frameProbe,
    mainProfile: parseMainProfile(elOut),
    electronLog: elOut.slice(-4000),
    electronErr: elErr.slice(-2000),
    viteLog: viteOut.slice(-2000)
  };

  if (!opts.keepOpen) cleanup();
  return result;
}

// 从 Electron stdout 里解析主进程 printReport 输出的阶段表
// ANSI 转义序列用 String.fromCharCode(27) 拼装，避免 ESLint no-control-regex 报错
const ANSI_RE = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');

function parseMainProfile(text) {
  const lines = String(text || '').split(/\r?\n/);
  const rows = [];
  let inReport = false;
  for (const raw of lines) {
    const line = raw.replace(ANSI_RE, '');
    if (/启动性能/.test(line) && /主进程/.test(line)) { inReport = true; continue; }
    if (!inReport) continue;
    if (/^─{5,}/.test(line.trim())) continue;
    if (/^$/.test(line.trim())) continue;
    // 形如 "     1234ms    56ms  main:createWindow"
    const m = line.match(/^\s*(\d+)ms\s+(—|\d+ms)\s+(.+?)\s*$/);
    if (m) {
      rows.push({
        at: parseInt(m[1], 10),
        dur: m[2] === '—' ? null : parseInt(m[2], 10),
        name: m[3]
      });
      continue;
    }
    if (/慢同步操作/.test(line)) break;
  }
  return rows;
}

// Electron 启动失败时给出可读原因（GPU 崩溃 / 端口占用 / 缺依赖）
async function diagnoseElectronFailure(elOut, elErr) {
  const all = elOut + '\n' + elErr;
  if (/GPU process isn't usable|0xC0000005|-1073741819/i.test(all)) {
    return 'Electron GPU 进程崩溃（典型于无独显/远程桌面/虚拟机环境）。请加 --no-gpu 重试。';
  }
  if (/Cannot find module|MODULE_NOT_FOUND/i.test(all)) {
    const m = all.match(/Cannot find module '([^']+)'/);
    return `Electron 启动失败：缺少模块 ${m ? m[1] : '(未知)'}。请先 npm install。`;
  }
  if (/EADDRINUSE/i.test(all)) return '端口被占用：请先关闭已运行的实例（npm run stop）。';
  return `Electron 未暴露调试端口，启动日志：\n${all.slice(-600)}`;
}

/* ── 报告 ───────────────────────────────────────────── */
function buildReport(runs) {
  const pick = (fn) => runs.map(fn).filter((n) => Number.isFinite(n));
  const stages = [
    ['Vite 依赖解析', (r) => r.marks.viteResolve],
    ['Vite 就绪(端口可连)', (r) => r.marks.vitePortOpen],
    ['Electron 启动→CDP 可用', (r) => r.marks.cdpList],
    ['Vue 挂载(app 有子节点)', (r) => r.appElPopulated],
    ['首屏 UI 可见(nav+main)', (r) => r.mountDone],
    ['DOMContentLoaded', (r) => r.domContentLoaded],
    ['load 事件', (r) => r.loadEvent],
    ['首次绘制(first-paint)', (r) => r.firstPaint],
    ['首次内容绘制(FCP)', (r) => r.firstContentfulPaint]
  ];
  return stages.map(([label, fn]) => ({
    label,
    values: pick(fn),
    median: median(pick(fn))
  }));
}

function printReport(runs) {
  const rows = buildReport(runs);
  const single = runs.length === 1;

  console.log('\n' + '═'.repeat(72));
  console.log('  启动性能报告' + (single ? '（单次）' : `（${runs.length} 次，取中位数）`));
  console.log('═'.repeat(72));
  console.log('  ' + '阶段'.padEnd(26) + '耗时(相对进程启动)');
  console.log('  ' + '─'.repeat(26) + ' ' + '─'.repeat(24));
  for (const r of rows) {
    const extra = !single && r.values.length > 1
      ? `   [${r.values.map((v) => v.toFixed(0)).join(', ')}]`
      : '';
    console.log('  ' + r.label.padEnd(26) + fmt(r.median) + extra);
  }

  const total = rows.find((r) => r.label.includes('首屏 UI 可见'));
  if (total && Number.isFinite(total.median)) {
    console.log('  ' + '─'.repeat(26) + ' ' + '─'.repeat(24));
    console.log('  ' + '总计：进程启动 → 首屏可见'.padEnd(20) + fmt(total.median));
  }

  // 事件时间线（仅单次时打印，便于观察顺序）
  if (single && runs[0].timeline.length) {
    console.log('\n  CDP 生命周期事件：');
    for (const ev of runs[0].timeline) {
      console.log(`    ${fmt(ev.at)}  ${ev.name}`);
    }
  }

  // 主进程分段（来自 MCU_STARTUP_PROFILE=1 的内建探针）
  if (single && runs[0].mainProfile && runs[0].mainProfile.length) {
    console.log('\n  主进程分段（electron stdout，相对进程启动）：');
    for (const s of runs[0].mainProfile) {
      const dur = s.dur == null ? '     —' : String(s.dur).padStart(6) + 'ms';
      console.log(`    ${String(s.at).padStart(7)}ms  ${dur}  ${s.name}`);
    }
  }

  // 渲染层权威时间线（探针 + PerformancePaintTiming）
  if (single) {
    const r = runs[0];
    const p = (r.perf && r.perf.probe) || null;
    if (p || (r.perf && (Number.isFinite(r.perf.firstPaint) || Number.isFinite(r.perf.firstContentfulPaint)))) {
      console.log('\n  渲染层时间线（相对导航开始）：');
      if (r.perf && Number.isFinite(r.perf.responseEnd)) console.log(`    ${fmt(r.perf.responseEnd)}  HTML 响应结束`);
      if (p && p.appMounted != null) console.log(`    ${fmt(p.appMounted)}  Vue 挂载完成（#app 有子节点）`);
      if (p && p.uiVisible != null) console.log(`    ${fmt(p.uiVisible)}  首屏布局完成（nav+main 可见）`);
      if (r.perf && Number.isFinite(r.perf.firstPaint)) console.log(`    ${fmt(r.perf.firstPaint)}  first-paint`);
      if (r.perf && Number.isFinite(r.perf.firstContentfulPaint)) console.log(`    ${fmt(r.perf.firstContentfulPaint)}  first-contentful-paint (FCP)`);
      if (r.perf && Number.isFinite(r.perf.domContentLoaded)) console.log(`    ${fmt(r.perf.domContentLoaded)}  DOMContentLoaded`);
      if (r.perf && Number.isFinite(r.perf.load)) console.log(`    ${fmt(r.perf.load)}  load`);
    }
  }

  // 卡顿检测
  console.log('\n  启动后 2s 内帧间隔（卡顿检测，>100ms 视为明显卡顿）：');
  for (const r of runs) {
    const f = r.frameProbe;
    if (f && Number.isFinite(f.maxFrameGapMs)) {
      const flag = f.maxFrameGapMs > 100 ? '  ⚠ 卡顿' : '';
      console.log(`    第 ${r.run} 次  最大帧间隔 = ${fmt(f.maxFrameGapMs)}   p95 = ${fmt(f.p95FrameGapMs)}   帧数 = ${f.frames}${flag}`);
    }
  }

  // IPC 探测
  console.log('\n  启动期 IPC 往返耗时：');
  for (const r of runs) {
    const ipc = r.ipcProbe || {};
    const parts = Object.entries(ipc)
      .filter(([k]) => k.endsWith('Ms'))
      .map(([k, v]) => `${k.replace(/Ms$/, '')}=${fmt(v).trim()}`);
    const errs = Object.entries(ipc).filter(([k]) => k.endsWith('Error'));
    if (parts.length) console.log(`    第 ${r.run} 次  ${parts.join('   ')}`);
    for (const [k, v] of errs) console.log(`    第 ${r.run} 次  ${k}: ${v}`);
  }
  console.log('');

  // 结论提示
  if (single) {
    const r = runs[0];
    const hints = [];
    const viteMs = r.marks.vitePortOpen;
    const cdpMs = r.marks.cdpList;
    const rendererSpan = (cdpMs != null && r.mountDone != null) ? r.mountDone - cdpMs : null;
    if (Number.isFinite(viteMs) && viteMs > 3000) hints.push(`Vite 冷启动偏慢（${viteMs.toFixed(0)}ms）——首次/依赖变更后需重新预构建，属一次性成本。`);
    if (Number.isFinite(rendererSpan) && rendererSpan > 5000) hints.push(`Electron 就绪后渲染层耗时 ${rendererSpan.toFixed(0)}ms 才出现首屏，需检查渲染层同步初始化与首屏组件树。`);
    const f = r.frameProbe;
    if (f && f.maxFrameGapMs > 100) hints.push(`存在最大 ${f.maxFrameGapMs}ms 的帧间隔，说明有同步任务阻塞主线程/主进程。`);
    if (hints.length) {
      console.log('  提示：');
      for (const h of hints) console.log('    · ' + h);
      console.log('');
    }
  }
}

/* ── 主流程 ─────────────────────────────────────────── */
async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (await portInUse(PORT)) {
    console.error(`[监控] 端口 ${PORT} 已被占用，请先执行 npm run stop 关闭已有实例。`);
    process.exit(2);
  }
  if (!fs.existsSync(path.join(ROOT, 'node_modules', 'vite'))) {
    console.error('[监控] 未找到 vite，请先 npm install。');
    process.exit(2);
  }

  console.log(`[监控] 启动 ${opts.runs} 次测量${opts.noGpu ? '（软件渲染）' : ''}…`);
  const runs = [];
  for (let i = 1; i <= opts.runs; i++) {
    process.stdout.write(`[监控] 第 ${i}/${opts.runs} 次… `);
    const startedAt = now();
    try {
      const r = await measureOnce(opts, i);
      runs.push(r);
      console.log(`完成（首屏可见 ${fmt(r.mountDone)}）`);
    } catch (e) {
      console.log('失败');
      console.error('  ' + (e && e.message ? e.message : e));
      if (!runs.length) process.exit(1);
      break;
    }
    // 两次之间留出端口/进程回收时间
    if (i < opts.runs) {
      console.log(`[监控] 等待清理（${((now() - startedAt) / 1000).toFixed(1)}s 已用）…`);
      await sleep(2500);
    }
  }

  if (!runs.length) process.exit(1);

  printReport(runs);

  if (opts.json) {
    const out = path.isAbsolute(opts.json) ? opts.json : path.join(ROOT, opts.json);
    fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), platform: process.platform, opts, runs }, null, 2));
    console.log(`[监控] 明细已写入 ${out}\n`);
  }

  // 清理可能残留的 Electron（Windows）
  if (process.platform === 'win32') {
    try { spawn('node', [path.join(__dirname, 'stop-electron.js')], { stdio: 'ignore', detached: true }).unref(); } catch {}
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('[监控] 异常终止：', e && e.stack ? e.stack : e);
  process.exit(1);
});
