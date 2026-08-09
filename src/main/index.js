// 加载 polyfill（install() 内部用 setImmediate 延迟执行，
// 先让 Electron 二进制 patch require('electron')，主进程代码首次 require 拿到真实 API）
require('./electron-api');
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

// 共享 flash-core：注入路径与配置加载器（必须在 require 领域模块前完成）
const { setPathsContext, setConfigLoader } = require('../../packages/flash-core');
const { loadConfig: loadDesktopConfig, flushSaveConfig } = require('./core/config');
setPathsContext({
  tempDir: () => app.getPath('temp'),
  userDataDir: () => app.getPath('userData'),
  toolsDir: () => path.join(app.getPath('userData'), 'tools'),
  appInstallRoot: () => (app.isPackaged ? path.dirname(app.getPath('exe')) : path.join(__dirname, '..', '..')),
  isPackaged: () => !!app.isPackaged
});
setConfigLoader(() => loadDesktopConfig());

const bus = require('./core/bus');
const httpApi = require('./core/http-server');
const updater = require('./core/updater');
const windows = require('./windows');
const { installTrustedIpcGuard } = require('./core/trusted-ipc');
const { registerCoreIpc } = require('./ipc/register-core-ipc');
const { registerToolchainIpc } = require('./ipc/register-toolchain-ipc');
const { registerProjectIpc } = require('./ipc/register-project-ipc');
const { registerFlashIpc } = require('./ipc/register-flash-ipc');
const { registerDebugIpc } = require('./ipc/register-debug-ipc');

installTrustedIpcGuard(ipcMain, windows.getMainWindow, windows.isTrustedRendererUrl);

/* ── 日志助手 ─────────────────────────────────────────── */
// 攒批：make 全量编译每秒可产生数百行日志，逐条 webContents.send 的 IPC 洪流会拖慢两端；
// 合并 30ms 窗口内的条目成数组一次推送（渲染端 useLog.appendLog 兼容数组/单条）
let logQueue = [];
let logTimer = null;
let logQueueBytes = 0;
const MAX_LOG_QUEUE_BYTES = 4 * 1024 * 1024;
const MAX_LOG_ENTRY_CHARS = 64 * 1024;

function normalizeLogEntry(entry) {
  const text = String(entry && entry.text != null ? entry.text : '');
  const clipped = text.length > MAX_LOG_ENTRY_CHARS
    ? text.slice(0, MAX_LOG_ENTRY_CHARS) + '\n… [日志内容已截断]'
    : text;
  return { text: clipped, type: entry && entry.type ? entry.type : 'info', ...(entry && entry.key ? { key: entry.key } : {}) };
}

function flushLogQueue() {
  if (logTimer) {
    clearTimeout(logTimer);
    logTimer = null;
  }
  if (!logQueue.length) return;
  const batch = logQueue;
  logQueue = [];
  logQueueBytes = 0;
  const window = windows.getMainWindow();
  if (window) window.webContents.send('log', batch);
}

function queueLog(entry) {
  const next = normalizeLogEntry(entry);
  const bytes = Buffer.byteLength(next.text, 'utf8');
  if (logQueue.length && logQueueBytes + bytes > MAX_LOG_QUEUE_BYTES) flushLogQueue();
  logQueue.push(next);
  logQueueBytes += bytes;
  if (logQueue.length >= 500) flushLogQueue();
  else if (!logTimer) logTimer = setTimeout(flushLogQueue, 30);
}

function send(text, type = 'info') {
  queueLog({ text, type });
}

function sendProgress(key, text) {
  queueLog({ text, type: 'progress', key });
}

function sendDownloadProgress(label, percent) {
  const window = windows.getMainWindow();
  if (window) window.webContents.send('download-progress', { label, percent });
}

bus.setSinks({ send, sendProgress, sendDownloadProgress });

const { startHttpApiFromConfig } = registerCoreIpc({ send });
registerToolchainIpc({ send });
registerProjectIpc();
registerFlashIpc({ send });
registerDebugIpc();

// 单实例：已运行则聚焦已有窗口，不再开新实例
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => windows.focusOrCreate());
  app.whenReady().then(() => {
    // Dock 图标：用多尺寸 icns / 带边距 PNG。禁止未留边 1024 全幅图（会显大）。
    try { if (windows.applyDockIcon) windows.applyDockIcon(); } catch {}
    windows.createWindow();
    startHttpApiFromConfig();
    updater.checkOnStartup();
  });
  app.on('activate', () => {
    if (app.isQuitting) return;
    windows.focusOrCreate();
  });
}

app.on('window-all-closed', () => {
  if (app.isQuitting) {
    app.quit();
    return;
  }
  if (process.platform === 'darwin') return;
  if (BrowserWindow.getAllWindows().length === 0) app.quit();
});

let quitCleanupStarted = false;
let quitCleanupDone = false;

function settleWithin(promise, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    Promise.resolve(promise).then(finish, finish);
  });
}

function cleanupSyncResources(reason) {
  try { flushSaveConfig(); } catch {}
  try {
    const mqtt = require('./devices/mqtt');
    if (mqtt && typeof mqtt.closeAllMqtt === 'function') mqtt.closeAllMqtt();
  } catch {}
  try {
    const { killAllRunningProcesses } = require('./toolchain/proc');
    killAllRunningProcesses(reason);
  } catch {}
  if (logTimer) { clearTimeout(logTimer); logTimer = null; }
  logQueue = [];
  logQueueBytes = 0;
}

app.on('before-quit', (event) => {
  try { app.isQuitting = true; } catch {}
  let installingUpdate = false;
  try { installingUpdate = app.updateQuitPrepared === true; } catch {}
  // 更新安装路径已在 updater.prepareForUpdateInstall() 中等待过资源释放，不能再次拦截 quitAndInstall。
  if (installingUpdate) {
    cleanupSyncResources('update-before-quit');
    return;
  }
  if (quitCleanupDone) return;
  event.preventDefault();
  if (quitCleanupStarted) return;
  quitCleanupStarted = true;
  cleanupSyncResources('app-before-quit');
  const pending = [];
  try { pending.push(settleWithin(httpApi.stop(), 1500)); } catch {}
  try {
    const serial = require('./devices/serial');
    if (serial && typeof serial.closeActiveSerial === 'function') pending.push(settleWithin(serial.closeActiveSerial(), 1500));
  } catch {}
  Promise.all(pending).finally(() => {
    quitCleanupDone = true;
    app.quit();
  });
});
