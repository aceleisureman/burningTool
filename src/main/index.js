// 加载 polyfill（install() 内部用 setImmediate 延迟执行，
// 先让 Electron 二进制 patch require('electron')，主进程代码首次 require 拿到真实 API）
require('./electron-api');
const { app, BrowserWindow } = require('electron');
const { flushSaveConfig } = require('./core/config');
const bus = require('./core/bus');
const httpApi = require('./core/http-server');
const updater = require('./core/updater');
const windows = require('./windows');
const { registerCoreIpc } = require('./ipc/register-core-ipc');
const { registerToolchainIpc } = require('./ipc/register-toolchain-ipc');
const { registerProjectIpc } = require('./ipc/register-project-ipc');
const { registerFlashIpc } = require('./ipc/register-flash-ipc');
const { registerDebugIpc } = require('./ipc/register-debug-ipc');

/* ── 日志助手 ─────────────────────────────────────────── */
// 攒批：make 全量编译每秒可产生数百行日志，逐条 webContents.send 的 IPC 洪流会拖慢两端；
// 合并 30ms 窗口内的条目成数组一次推送（渲染端 useLog.appendLog 兼容数组/单条）
let logQueue = [];
let logTimer = null;

function flushLogQueue() {
  if (logTimer) {
    clearTimeout(logTimer);
    logTimer = null;
  }
  if (!logQueue.length) return;
  const batch = logQueue;
  logQueue = [];
  const window = windows.getMainWindow();
  if (window) window.webContents.send('log', batch);
}

function queueLog(entry) {
  logQueue.push(entry);
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

app.on('before-quit', () => {
  try { app.isQuitting = true; } catch {}
  try { flushSaveConfig(); } catch {}
  try { httpApi.stop(); } catch {}
  try {
    const serial = require('./devices/serial');
    if (serial && typeof serial.closeActiveSerial === 'function') serial.closeActiveSerial();
  } catch {}
  try {
    const mqtt = require('./devices/mqtt');
    if (mqtt && typeof mqtt.closeAllMqtt === 'function') mqtt.closeAllMqtt();
  } catch {}
  try {
    const { killAllRunningProcesses } = require('./toolchain/proc');
    killAllRunningProcesses('app-before-quit');
  } catch {}
});
