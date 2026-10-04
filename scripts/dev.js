// 开发启动：先拉起 Vite dev server，端口就绪后再启动 Electron（注入 VITE_DEV_SERVER_URL）。
// 渲染层经 http 加载，HMR 可用；Electron 退出时一并关闭 Vite。
// 打包/正式产物走 `npm run build:renderer` + electron-builder（加载 renderer/dist）。
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

const PORT = 5173;
const DEV_URL = `http://localhost:${PORT}`;
const ROOT = path.join(__dirname, '..');
const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');

const vitePkg = require.resolve('vite/package.json');
const viteBin = path.join(path.dirname(vitePkg), 'bin', 'vite.js');
const vite = spawn(process.execPath, [viteBin, '--host', '127.0.0.1'], { stdio: 'inherit', cwd: ROOT });

let electron = null;
let viteExited = false;
function cleanup() {
  try { if (electron) electron.kill(); } catch {}
  try { vite.kill(); } catch {}
}
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
// Vite 自身退出（崩溃 / strictPort 占用）：若 Electron 还没起来就整体退出，
// 避免 waitPort 盲等并连到「别的进程碰巧占用 5173」的服务。
vite.on('exit', (code) => {
  viteExited = true;
  if (!electron) { console.error(`[dev] Vite dev server 已退出（code=${code}）`); cleanup(); process.exit(code || 0); }
});

function waitPort(tries = 0) {
  if (viteExited) return; // Vite 已退出，等它的 exit 处理收尾
  const sock = net.connect(PORT, '127.0.0.1');
  sock.once('connect', () => { sock.destroy(); if (!viteExited) launchElectron(); });
  sock.once('error', () => {
    sock.destroy();
    if (tries > 200) { console.error('[dev] Vite dev server 启动超时'); cleanup(); process.exit(1); }
    setTimeout(() => waitPort(tries + 1), 150);
  });
}

function launchElectron() {
  const electronBin = process.platform === 'darwin'
    ? path.join(ELECTRON_DIST, 'Electron.app', 'Contents', 'MacOS', 'Electron')
    : process.platform === 'win32'
      ? path.join(ELECTRON_DIST, 'electron.exe')
      : path.join(ELECTRON_DIST, 'electron');
  if (!require('fs').existsSync(electronBin)) {
    console.error('[dev] Electron 可执行文件不存在:', electronBin);
    cleanup();
    process.exit(1);
  }
  // 无独显 / 远程桌面 / 虚拟机环境常出现 GPU 进程崩溃
  //   （exit_code=-1073741819 / 0xC0000005，最终 "GPU process isn't usable. Goodbye."）。
  // 这些机器可设环境变量 MCU_DISABLE_GPU=1 走软件渲染，无需手拼命令行参数。
  const extraArgs = [];
  if (String(process.env.MCU_DISABLE_GPU || '').trim() === '1') {
    // 刻意不传 --in-process-gpu：它会把 GPU 代码跑进浏览器进程，实测常直接带崩整个应用
    // （配合 --remote-debugging-port 时尤其容易启动后数秒内退出）。
    extraArgs.push('--disable-gpu', '--disable-gpu-compositing', '--disable-software-rasterizer');
    console.log('[dev] MCU_DISABLE_GPU=1：以软件渲染模式启动 Electron（规避 GPU 崩溃）');
  }
  // 调试端口：设 MCU_DEBUG_PORT=9222 即可用 CDP 连上渲染层（脚本/DevTools 排查用）
  const dbgPort = String(process.env.MCU_DEBUG_PORT || '').trim();
  if (/^\d+$/.test(dbgPort)) {
    extraArgs.push(`--remote-debugging-port=${dbgPort}`);
    console.log(`[dev] MCU_DEBUG_PORT=${dbgPort}：已开启 CDP 调试端口（http://127.0.0.1:${dbgPort}/json/list）`);
  }
  // 内存排查：MCU_EXPOSE_GC=1 向渲染进程暴露 V8 的 gc()，
  // 让设置页「内存监控 → 触发 GC」能同时回收渲染进程堆（默认不开，避免干扰正常 GC 节奏）。
  if (String(process.env.MCU_EXPOSE_GC || '').trim() === '1') {
    extraArgs.push('--js-flags=--expose-gc');
    console.log('[dev] MCU_EXPOSE_GC=1：已向渲染进程暴露 gc()');
  }
  // 逃生口：MCU_ELECTRON_ARGS="--flagA --flagB" 直接追加任意 Electron/Chromium 参数，
  // 用于排查 GPU/渲染异常时临时试不同组合，无需改代码。
  const rawArgs = String(process.env.MCU_ELECTRON_ARGS || '').trim();
  if (rawArgs) {
    const extra = rawArgs.split(/\s+/).filter(Boolean);
    extraArgs.push(...extra);
    console.log('[dev] MCU_ELECTRON_ARGS：追加 ' + extra.join(' '));
  }
  electron = spawn(electronBin, ['.', ...extraArgs], {
    stdio: 'inherit',
    cwd: ROOT,
    env: (() => { const e = { ...process.env, VITE_DEV_SERVER_URL: DEV_URL }; delete e.ELECTRON_RUN_AS_NODE; return e; })()
  });
  electron.on('exit', (code) => { cleanup(); process.exit(code || 0); });
}

waitPort();
