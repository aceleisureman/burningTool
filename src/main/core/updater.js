// 自动更新：基于 electron-updater + GitHub Releases
// CI 每次构建发布新版本（1.0.<构建号>），应用启动后自动检查、
// 静默下载，下载完成弹窗询问是否立即重启安装。
const { app, dialog, BrowserWindow } = require('electron');
const bus = require('./bus');

let autoUpdater = null;
let state = { status: 'idle', version: null, percent: 0, error: null };
let installing = false;
let forceExitTimer = null;

function setState(patch) {
  state = Object.assign({}, state, patch);
  return state;
}

function getUpdater() {
  if (!autoUpdater) {
    ({ autoUpdater } = require('electron-updater'));
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    wireEvents(autoUpdater);
  }
  return autoUpdater;
}

function wireEvents(u) {
  u.on('checking-for-update', () => {
    if (!installing) setState({ status: 'checking', error: null });
  });
  u.on('update-available', (info) => {
    if (installing) return;
    setState({ status: 'downloading', version: info.version, error: null });
    bus.send('发现新版本 v' + info.version + '，正在后台下载…', 'info');
  });
  u.on('update-not-available', () => {
    if (!installing) setState({ status: 'latest', error: null });
  });
  u.on('download-progress', (p) => {
    if (installing) return;
    setState({ status: 'downloading', percent: Math.round(p.percent) });
    bus.sendProgress('app-update', '下载更新 v' + state.version + ': ' + Math.round(p.percent) + '%');
  });
  u.on('update-downloaded', async (info) => {
    if (installing) return;
    setState({ status: 'downloaded', version: info.version, percent: 100, error: null });
    bus.send('新版本 v' + info.version + ' 已下载完成', 'success');
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: '发现新版本',
      message: '新版本 v' + info.version + ' 已下载完成，是否立即重启更新？',
      buttons: ['立即重启更新', '退出时自动安装'],
      defaultId: 0,
      cancelId: 1
    });
    if (response === 0) await quitAndInstall({ silent: false, forceRunAfter: true });
  });
  u.on('error', (err) => {
    const msg = String(err && err.message || err);
    if (installing) installing = false;
    setState({ status: 'error', error: msg });
    // 网络失败等属常态，仅记日志不打扰用户
    bus.send('检查更新失败: ' + msg, 'warn');
  });
}

async function prepareForUpdateInstall() {
  const summary = { serial: false, mqtt: false, http: false, processes: 0 };
  try {
    const serial = require('../devices/serial');
    if (typeof serial.closeActiveSerial === 'function') {
      await serial.closeActiveSerial();
      summary.serial = true;
    }
  } catch {}
  try {
    const mqtt = require('../devices/mqtt');
    if (typeof mqtt.closeAllMqtt === 'function') {
      mqtt.closeAllMqtt();
      summary.mqtt = true;
    }
  } catch {}
  try {
    const httpApi = require('./http-server');
    if (httpApi && typeof httpApi.stop === 'function') {
      await Promise.race([
        httpApi.stop(),
        new Promise((resolve) => setTimeout(resolve, 1500))
      ]);
      summary.http = true;
    }
  } catch {}
  try {
    const proc = require('../toolchain/proc');
    if (typeof proc.killAllRunningProcesses === 'function') {
      const r = proc.killAllRunningProcesses('update-install');
      summary.processes = r && r.killed ? r.killed : 0;
    }
  } catch {}
  // 尽量先关掉窗口，减少渲染进程拖住退出
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.removeAllListeners('close'); } catch {}
      try { if (!win.isDestroyed()) win.destroy(); } catch {}
    }
  } catch {}
  return summary;
}

function scheduleForceExit(ms) {
  const wait = typeof ms === 'number' ? ms : 5000;
  if (forceExitTimer) clearTimeout(forceExitTimer);
  forceExitTimer = setTimeout(() => {
    try { bus.send('[更新] 退出超时，强制结束进程以继续安装', 'warn'); } catch {}
    try { app.exit(0); } catch {}
    try { process.exit(0); } catch {}
  }, wait);
  if (forceExitTimer.unref) forceExitTimer.unref();
}

// 启动后延迟检查，避免拖慢首屏；开发模式（未打包）不检查
function checkOnStartup(delayMs) {
  if (!app.isPackaged) return;
  setTimeout(() => {
    getUpdater().checkForUpdates().catch(() => {});
  }, typeof delayMs === 'number' ? delayMs : 5000);
}

// 手动检查（供渲染层"检查更新"按钮调用）
async function checkNow() {
  if (!app.isPackaged) return { ok: false, error: '开发模式不支持更新' };
  if (installing) return { ok: false, error: '正在安装更新，请稍候' };
  if (state.status === 'downloading') return { ok: true, state: getState(), note: 'already-downloading' };
  if (state.status === 'downloaded') return { ok: true, state: getState(), note: 'already-downloaded' };
  try {
    await getUpdater().checkForUpdates();
    return { ok: true, state: getState() };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

async function quitAndInstall(opts) {
  opts = opts || {};
  if (installing) return { ok: true, state: getState(), note: 'already-installing' };
  if (state.status !== 'downloaded' && state.status !== 'installing') {
    return { ok: false, error: '更新包尚未下载完成', state: getState() };
  }
  installing = true;
  setState({ status: 'installing', error: null });
  bus.send('[更新] 正在关闭串口/MQTT/子进程并准备安装…', 'step');

  let summary = {};
  try {
    summary = await prepareForUpdateInstall();
    if (summary.processes) bus.send('[更新] 已结束 ' + summary.processes + ' 个活动子进程', 'info');
  } catch (e) {
    bus.send('[更新] 资源清理异常: ' + (e && e.message ? e.message : e), 'warn');
  }

  const silent = opts.silent === true;
  const forceRunAfter = opts.forceRunAfter !== false;
  try {
    // isSilent, isForceRunAfter：装完后自动拉起新版本
    getUpdater().quitAndInstall(silent, forceRunAfter);
    scheduleForceExit(5000);
    bus.send('[更新] 已请求退出并安装，若窗口未关闭将在数秒后强制结束', 'info');
    return { ok: true, state: getState(), summary };
  } catch (err) {
    installing = false;
    const msg = String(err && err.message || err);
    setState({ status: 'downloaded', error: msg });
    bus.send('[更新] 启动安装失败: ' + msg, 'error');
    return { ok: false, error: msg, state: getState(), summary };
  }
}

function getState() {
  return Object.assign({}, state, { currentVersion: app.getVersion() });
}

module.exports = { checkOnStartup, checkNow, quitAndInstall, getState, prepareForUpdateInstall };
