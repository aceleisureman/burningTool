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
function cleanup() {
  try { if (electron) electron.kill(); } catch {}
  try { vite.kill(); } catch {}
}
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
vite.on('exit', (code) => { if (!electron) process.exit(code || 0); });

function waitPort(tries = 0) {
  const sock = net.connect(PORT, '127.0.0.1');
  sock.once('connect', () => { sock.destroy(); launchElectron(); });
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
  electron = spawn(electronBin, ['.'], {
    stdio: 'inherit',
    cwd: ROOT,
    env: (() => { const e = { ...process.env, VITE_DEV_SERVER_URL: DEV_URL }; delete e.ELECTRON_RUN_AS_NODE; return e; })()
  });
  electron.on('exit', (code) => { cleanup(); process.exit(code || 0); });
}

waitPort();
