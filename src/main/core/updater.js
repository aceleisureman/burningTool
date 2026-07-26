// 自动更新：基于 electron-updater + GitHub Releases
// CI 每次构建发布新版本（1.0.<构建号>），应用启动后自动检查、
// 静默下载，下载完成弹窗询问是否立即重启安装。
//
// macOS 注意：
// 1. 自动更新依赖 zip 产物（latest-mac.yml 指向 *-mac.zip），不是 dmg
// 2. 当前 CI 关闭代码签名（CSC_IDENTITY_AUTO_DISCOVERY=false），
//    必须关闭校验，否则 MacUpdater 会因签名不一致拒绝安装
// 3. quitAndInstall 由 electron-updater 拉起 ShipIt 替换 .app，
//    强杀进程要留给 ShipIt 启动后，且不能拖住 before-quit
const { app, dialog, BrowserWindow } = require('electron');
const bus = require('./bus');

let autoUpdater = null;
let state = { status: 'idle', version: null, percent: 0, error: null, platform: process.platform };
let installing = false;
let forceExitTimer = null;
let promptShownForVersion = null;
let lastErrorAt = 0;

function setState(patch) {
  state = Object.assign({}, state, patch);
  broadcastState();
  return state;
}

function getState() {
  return Object.assign({}, state, {
    currentVersion: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged
  });
}

function broadcastState() {
  const snapshot = getState();
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
        win.webContents.send('update-status', snapshot);
      }
    }
  } catch {}
}

function isMac() {
  return process.platform === 'darwin';
}

function getUpdater() {
  if (!autoUpdater) {
    ({ autoUpdater } = require('electron-updater'));
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    // 未签名/ad-hoc 签名包：关闭校验，否则 macOS 下载后安装必失败
    // Windows/Linux 不受此开关影响（各自走不同校验路径）
    if (typeof autoUpdater.verifyUpdateCodeSignature === 'boolean' || 'verifyUpdateCodeSignature' in autoUpdater) {
      autoUpdater.verifyUpdateCodeSignature = false;
    }
    // 降低 electron-updater 噪音，但仍保留关键错误到业务日志
    try {
      autoUpdater.logger = {
        info: (...a) => { try { bus.send('[更新] ' + a.join(' '), 'info'); } catch {} },
        warn: (...a) => { try { bus.send('[更新] ' + a.join(' '), 'warn'); } catch {} },
        error: (...a) => { try { bus.send('[更新] ' + a.join(' '), 'error'); } catch {} },
        debug: () => {}
      };
    } catch {}
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
    setState({ status: 'downloading', version: info.version, percent: 0, error: null });
    bus.send('发现新版本 v' + info.version + '，正在后台下载…', 'info');
  });
  u.on('update-not-available', () => {
    if (!installing) setState({ status: 'latest', error: null });
  });
  u.on('download-progress', (p) => {
    if (installing) return;
    const percent = Math.round((p && p.percent) || 0);
    // 同百分比不重复推送，避免高频 IPC 拖慢渲染
    if (state.status === 'downloading' && state.percent === percent) return;
    setState({ status: 'downloading', percent });
    bus.sendProgress('app-update', '下载更新 v' + (state.version || '') + ': ' + percent + '%');
  });
  u.on('update-downloaded', async (info) => {
    if (installing) return;
    const version = info && info.version ? info.version : state.version;
    setState({ status: 'downloaded', version, percent: 100, error: null });
    bus.send('新版本 v' + version + ' 已下载完成', 'success');
    // 同一版本只弹一次，避免启动检查 + 手动检查重复弹窗
    if (promptShownForVersion === version) return;
    promptShownForVersion = version;
    try {
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      const boxOpts = {
        type: 'info',
        title: '发现新版本',
        message: '新版本 v' + version + ' 已下载完成，是否立即重启更新？',
        detail: isMac()
          ? 'macOS 将替换应用程序包并自动重新打开。请确保应用不在只读磁盘镜像中运行（建议放到「应用程序」文件夹）。'
          : '将关闭当前窗口并安装更新，安装完成后自动重新打开。',
        buttons: ['立即重启更新', '退出时自动安装'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      };
      const { response } = win && !win.isDestroyed()
        ? await dialog.showMessageBox(win, boxOpts)
        : await dialog.showMessageBox(boxOpts);
      if (response === 0) await quitAndInstall({ silent: false, forceRunAfter: true });
    } catch (err) {
      bus.send('[更新] 弹窗失败: ' + (err && err.message ? err.message : err), 'warn');
    }
  });
  u.on('error', (err) => {
    const msg = normalizeUpdateError(err);
    if (installing) installing = false;
    setState({ status: 'error', error: msg });
    // 节流：网络抖动时避免刷屏
    const now = Date.now();
    if (now - lastErrorAt > 3000) {
      lastErrorAt = now;
      bus.send('检查/下载更新失败: ' + msg, 'warn');
    }
  });
}

function normalizeUpdateError(err) {
  const raw = String((err && err.message) || err || 'unknown');
  // 常见 macOS / 网络错误给出可操作提示
  if (/code signature|signature|notariz|Gatekeeper/i.test(raw)) {
    return raw + '（当前构建未启用 Apple 代码签名；已尝试跳过校验。若仍失败请重新下载完整安装包）';
  }
  if (/ENOENT|latest-mac\.yml|Cannot find channel/i.test(raw)) {
    return raw + '（未找到 mac 更新清单 latest-mac.yml，请确认 CI 已发布 zip 产物）';
  }
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|net::|403|429|rate limit/i.test(raw)) {
    return raw + '（网络访问 GitHub 失败，可稍后重试或检查代理）';
  }
  return raw;
}

async function prepareForUpdateInstall() {
  const summary = { serial: false, mqtt: false, http: false, processes: 0, tray: false };
  // 先标记真正退出并拆掉托盘，否则窗口 close 会被拦截成 hide，macOS 进程也难干净退出
  try {
    const windows = require('../windows');
    if (windows && typeof windows.prepareForQuit === 'function') {
      windows.prepareForQuit();
      summary.tray = true;
    } else {
      app.isQuitting = true;
    }
  } catch {
    try { app.isQuitting = true; } catch {}
  }
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
  // macOS：destroy 前去掉 close 监听，避免拦截 quit
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.removeAllListeners('close'); } catch {}
      try { if (!win.isDestroyed()) win.destroy(); } catch {}
    }
  } catch {}
  return summary;
}

function scheduleForceExit(ms) {
  // macOS 上 ShipIt 需要主进程正常退出后接管；给更长宽限，避免过早 process.exit 打断替换
  const defaultWait = isMac() ? 12000 : 5000;
  const wait = typeof ms === 'number' ? ms : defaultWait;
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
  // macOS 从 dmg 只读卷运行时更新会失败，给用户提示但仍尝试检查
  if (isMac()) {
    try {
      const exe = process.execPath || '';
      if (/\/Volumes\//.test(exe)) {
        bus.send('[更新] 检测到应用正在 DMG/只读卷中运行，自动更新可能失败；请先拖到「应用程序」文件夹再使用', 'warn');
      }
    } catch {}
  }
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
    setState({ status: 'checking', error: null });
    const result = await getUpdater().checkForUpdates();
    return { ok: true, state: getState(), updateInfo: result && result.updateInfo ? result.updateInfo : null };
  } catch (err) {
    const msg = normalizeUpdateError(err);
    setState({ status: 'error', error: msg });
    return { ok: false, error: msg, state: getState() };
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
  // macOS：forceRunAfter 确保 ShipIt 装完后拉起新版本
  const forceRunAfter = opts.forceRunAfter !== false;
  try {
    // 阻止后续窗口在 activate 时被重新创建，干扰退出
    try { app.removeAllListeners('activate'); } catch {}
    // isSilent, isForceRunAfter：装完后自动拉起新版本
    getUpdater().quitAndInstall(silent, forceRunAfter);
    scheduleForceExit(isMac() ? 12000 : 5000);
    bus.send('[更新] 已请求退出并安装，若窗口未关闭将在数秒后强制结束', 'info');
    return { ok: true, state: getState(), summary };
  } catch (err) {
    installing = false;
    const msg = normalizeUpdateError(err);
    setState({ status: 'downloaded', error: msg });
    bus.send('[更新] 启动安装失败: ' + msg, 'error');
    return { ok: false, error: msg, state: getState(), summary };
  }
}

module.exports = {
  checkOnStartup,
  checkNow,
  quitAndInstall,
  getState,
  prepareForUpdateInstall,
  broadcastState
};
