// 窗口层：主窗口 / 系统托盘 的生命周期与状态，串口选择授权、开发热重载。
// 日志经 bus；窗口状态(mainWindow/tray)在本模块内维护，对外仅暴露 createWindow/getMainWindow/focusOrCreate。
const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const bus = require('./core/bus');
const { loadConfig, saveConfig } = require('./core/config');

const APP_ICON = path.join(__dirname, '..', '..', 'assets', 'icons', 'icon.png');
const TRAY_ICON = process.platform === 'win32'
  ? path.join(__dirname, '..', '..', 'assets', 'icons', 'icon.ico')
  : path.join(__dirname, '..', '..', 'assets', 'icons', '24x24.png');

let mainWindow;
let tray = null;

// 渲染层加载：开发(dev server, npm start 注入 VITE_DEV_SERVER_URL)用 loadURL；
// 否则加载 Vite 产物 renderer/dist/*.html（打包后亦走此路径）。
const DEV_URL = process.env.VITE_DEV_SERVER_URL || '';
function loadRenderer(win, page) {
  if (DEV_URL) win.loadURL(DEV_URL.replace(/\/$/, '') + '/' + page);
  else win.loadFile(path.join(__dirname, '..', '..', 'renderer', 'dist', page));
}

function getMainWindow() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

// 恢复并聚焦主窗口（不存在则重建）
function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

// 真正退出（绕过关闭=最小化到托盘的拦截）
function quitApp() {
  app.isQuitting = true;
  if (tray && !tray.isDestroyed()) { try { tray.destroy(); } catch {} tray = null; }
  if (mainWindow && !mainWindow.isDestroyed()) { try { mainWindow.close(); } catch {} }
  app.quit();
}

// 系统托盘：图标 + 右键菜单（显示主窗口 / 退出）
function createTray() {
  if (tray && !tray.isDestroyed()) return;
  // 依次尝试多个图标来源：.ico 在部分 Windows/Electron 下 createFromPath 会返回空，
  // 故回退到多种尺寸的 PNG（Electron 对 PNG 解码最稳）。任一非空即用。
  const candidates = [
    TRAY_ICON,
    path.join(__dirname, '..', '..', 'assets', 'icons', '32x32.png'),
    path.join(__dirname, '..', '..', 'assets', 'icons', '24x24.png'),
    path.join(__dirname, '..', '..', 'assets', 'icons', '256x256.png'),
    APP_ICON,
    path.join(__dirname, '..', '..', 'assets', 'icons', 'icon.icns')
  ];
  let img = nativeImage.createEmpty();
  for (const p of candidates) {
    try { const m = nativeImage.createFromPath(p); if (m && !m.isEmpty()) { img = m; break; } } catch {}
  }
  // 即使图标全部加载失败也不能让托盘创建抛错拖垮应用启动
  try {
    tray = new Tray(img);
  } catch (e) {
    bus.send(`[托盘] 图标加载失败，已跳过系统托盘：${e && e.message ? e.message : e}`, 'warn');
    tray = null;
    return;
  }
  tray.setToolTip('STM32 工具箱');
  const buildMenu = () => Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => showMainWindow() },
    { type: 'separator' },
    { label: '退出', click: () => quitApp() }
  ]);
  tray.setContextMenu(buildMenu());
  tray.on('click', () => showMainWindow());
  tray.on('double-click', () => showMainWindow());
  tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));
}

// 去抖：连续触发只执行最后一次（用于 resize/move 保存、热重载）
function debounce(fn, ms = 300) {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ── 窗口 ─────────────────────────────────────────────── */
// 串口选择回调：渲染端 navigator.serial.requestPort() 会触发 select-serial-port，
// 主进程把可用端口列表发给渲染端选，选完再通过 callback 返回。
let serialSelectCallback = null;
function setupSerial(win) {
  const ses = win.webContents.session;
  // 仅放行串口(serial)权限，避免无条件放开所有权限请求
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'serial');
  try { ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'serial')); } catch {}
  // 设备授权：用户在 select-serial-port 中选定的串口设备放行
  try { ses.setDevicePermissionHandler(() => true); } catch {}
  win.webContents.on('select-serial-port', (event, portList, _wc, callback) => {
    event.preventDefault();
    serialSelectCallback = callback;
    const list = (portList || []).map((p) => ({
      portId: p.portId, portName: p.portName, displayName: p.displayName,
      vendorId: p.vendorId, productId: p.productId
    }));
    if (win && !win.isDestroyed()) win.webContents.send('serial-ports', list);
  });
  // 渲染端选中/取消后回调（传空字符串 = 取消）
  ipcMain.removeAllListeners('serial-pick');
  ipcMain.on('serial-pick', (_e, portId) => {
    if (serialSelectCallback) { serialSelectCallback(portId || ''); serialSelectCallback = null; }
  });
}

function createWindow() {
  const cfg = loadConfig();
  const b = cfg.windowBounds || {};
  mainWindow = new BrowserWindow({
    width: b.width || 1140,
    height: b.height || 760,
    ...(Number.isInteger(b.x) && Number.isInteger(b.y) ? { x: b.x, y: b.y } : {}),
    minWidth: 900,
    minHeight: 560,
    title: 'STM32 工具箱',
    icon: APP_ICON,
    backgroundColor: '#eef2f7',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setMenuBarVisibility(false);
  setupSerial(mainWindow);
  loadRenderer(mainWindow, 'index.html');

  // 记忆窗口尺寸/位置：resize/move 去抖保存 + 关闭前再存一次
  const saveBounds = debounce(() => {
    try { if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMinimized()) saveConfig({ windowBounds: mainWindow.getBounds() }); } catch {}
  });
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);
  // 关闭窗口=最小化到系统托盘（不退出）；真正退出走托盘「退出」（会置 app.isQuitting）
  mainWindow.on('close', (e) => {
    try { saveConfig({ windowBounds: mainWindow.getBounds() }); } catch {}
    if (!app.isQuitting) { e.preventDefault(); mainWindow.hide(); return; }
  });

  setupHotReload(mainWindow);
  createTray();
}

/* ── 开发热重载（默认关闭，显式开启）──────────────────────
 * 改 renderer/* → 自动刷新窗口；改 main.js / preload.js → 自动重启整个 app。
 * 某些环境下 fs.watch 会反复触发，导致窗口不停重启，所以只在明确设置
 * ELECTRON_HOT_RELOAD=1 时才启用。
 */
function setupHotReload(win) {
  if (app.isPackaged) return;            // 打包后不启用
  if (process.env.ELECTRON_HOT_RELOAD !== '1') return;
  const debounce = (fn, ms = 200) => {
    let t = null;
    return () => { clearTimeout(t); t = setTimeout(fn, ms); };
  };
  const reloadRenderer = debounce(() => {
    if (win && !win.isDestroyed()) {
      win.webContents.reloadIgnoringCache();
      bus.send('[热重载] 界面已刷新', 'info');
    }
  });
  const restartApp = debounce(() => { app.relaunch(); app.exit(0); });
  const watch = (target, handler) => {
    try {
      const opts = fs.statSync(target).isDirectory() ? { recursive: true } : {};
      fs.watch(target, opts, handler);
    } catch (e) { /* 监听失败不影响正常使用 */ }
  };
  watch(path.join(__dirname, '..', '..', 'renderer'), reloadRenderer);
  watch(path.join(__dirname, 'index.js'), restartApp);
  watch(path.join(__dirname, '..', 'preload', 'index.js'), restartApp);
  console.log('[热重载] 已启用：renderer 改动刷新窗口，main/preload 改动重启 app');
}

// 第二实例唤起 / Dock 激活：有主窗口则聚焦，否则新建
function focusOrCreate() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

module.exports = { createWindow, getMainWindow, focusOrCreate, APP_ICON };
