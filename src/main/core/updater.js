// 自动更新：基于 electron-updater + GitHub Releases
// CI 每次构建发布新版本（1.0.<构建号>），应用启动后自动检查、
// 静默下载，下载完成弹窗询问是否立即重启安装。
const { app, dialog } = require('electron');
const bus = require('./bus');

let autoUpdater = null;
let state = { status: 'idle', version: null, percent: 0, error: null };

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
    state = { ...state, status: 'checking', error: null };
  });
  u.on('update-available', (info) => {
    state = { ...state, status: 'downloading', version: info.version };
    bus.send(`发现新版本 v${info.version}，正在后台下载…`, 'info');
  });
  u.on('update-not-available', () => {
    state = { ...state, status: 'latest' };
  });
  u.on('download-progress', (p) => {
    state = { ...state, status: 'downloading', percent: Math.round(p.percent) };
    bus.sendProgress('app-update', `下载更新 v${state.version}: ${Math.round(p.percent)}%`);
  });
  u.on('update-downloaded', async (info) => {
    state = { ...state, status: 'downloaded', version: info.version, percent: 100 };
    bus.send(`新版本 v${info.version} 已下载完成`, 'success');
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: '发现新版本',
      message: `新版本 v${info.version} 已下载完成，是否立即重启更新？`,
      buttons: ['立即重启更新', '退出时自动安装'],
      defaultId: 0,
      cancelId: 1
    });
    if (response === 0) u.quitAndInstall();
  });
  u.on('error', (err) => {
    state = { ...state, status: 'error', error: String(err && err.message || err) };
    // 网络失败等属常态，仅记日志不打扰用户
    bus.send(`检查更新失败: ${state.error}`, 'warn');
  });
}

// 启动后延迟检查，避免拖慢首屏；开发模式（未打包）不检查
function checkOnStartup(delayMs = 5000) {
  if (!app.isPackaged) return;
  setTimeout(() => {
    getUpdater().checkForUpdates().catch(() => {});
  }, delayMs);
}

// 手动检查（供渲染层"检查更新"按钮调用）
async function checkNow() {
  if (!app.isPackaged) return { ok: false, error: '开发模式不支持更新' };
  try {
    await getUpdater().checkForUpdates();
    return { ok: true, state };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

function quitAndInstall() {
  if (state.status === 'downloaded') getUpdater().quitAndInstall();
  return state;
}

function getState() {
  return { ...state, currentVersion: app.getVersion() };
}

module.exports = { checkOnStartup, checkNow, quitAndInstall, getState };
