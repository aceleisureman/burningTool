/**
 * electron-api.js
 *
 * Electron 主进程 API 运行时 polyfill。
 * 当 Electron 二进制无法通过 require('electron') 注入原生 API 时，
 * 本模块通过 require hook 拦截调用并返回功能等效的 API 对象。
 */

const Module = require('module');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const os = require('os');

const _projectRoot = path.resolve(__dirname, '..');

/* ── nativeImage ──────────────────────────────────────── */
const nativeImage = {
  createFromPath(filePath) {
    return { isEmpty: () => !fs.existsSync(filePath) };
  },
  createEmpty() {
    return { isEmpty: () => true };
  },
  createFromBuffer(buffer) {
    return { isEmpty: () => !buffer || buffer.length === 0 };
  },
};

/* ── dialog ───────────────────────────────────────────── */
const dialog = {
  showOpenDialog() { return Promise.resolve({ canceled: true, filePaths: [] }); },
  showSaveDialog() { return Promise.resolve({ canceled: true, filePath: '' }); },
  showMessageBox(opts = {}) { return Promise.resolve({ response: opts.defaultId || 0, checkboxChecked: false }); },
  showErrorBox(title, content) { console.error(`[dialog] ${title}: ${content}`); },
};

/* ── IPC 通信（主进程 ↔ preload）────────────────────────
 *  利用 process 对象在同一个 Node.js 进程内跨 V8 isolate 共享数据
 *  主进程和 preload 各自写入/读取同一个 process 属性
 * ─────────────────────────────────────────────────────── */
process.__mcutoolboxIpc = process.__mcutoolboxIpc || new EventEmitter();
process.__mcutoolboxReplies = process.__mcutoolboxReplies || {};
const _ipcCh = process.__mcutoolboxIpc;
const _ipcReplies = process.__mcutoolboxReplies;

const ipcRenderer = {
  invoke(channel, ...args) {
    return new Promise((resolve) => {
      const replyId = 'r:' + channel + ':' + Date.now() + ':' + Math.random().toString(36).slice(2, 6);
      _ipcReplies[replyId] = resolve;
      setTimeout(() => {
        if (_ipcReplies[replyId]) { delete _ipcReplies[replyId]; resolve(undefined); }
      }, 30000);
      _ipcCh.emit('main:' + channel, { replyId, args });
    });
  },
  send(channel, ...args) { _ipcCh.emit('main:' + channel, { args }); },
  sendSync() { return undefined; },
  on(channel, fn) {
    const wrapped = (...a) => fn(...a);
    _ipcCh.on('renderer:' + channel, wrapped);
    return { remove: () => _ipcCh.removeListener('renderer:' + channel, wrapped) };
  },
  once(channel, fn) {
    const wrapped = (...a) => fn(...a);
    _ipcCh.once('renderer:' + channel, wrapped);
    return { remove: () => _ipcCh.removeListener('renderer:' + channel, wrapped) };
  },
  removeListener(channel, fn) { _ipcCh.removeListener('renderer:' + channel, fn); },
  removeAllListeners(channel) { _ipcCh.removeAllListeners('renderer:' + channel); },
};

class IpcMain extends EventEmitter {
  handle(channel, listener) {
    const wrapped = async (msg) => {
      const { replyId, args } = msg || {};
      try {
        const result = await listener(null, ...(args || []));
        if (replyId && _ipcReplies[replyId]) {
          _ipcReplies[replyId](result);
          delete _ipcReplies[replyId];
        }
        if (replyId) _ipcCh.emit('renderer:' + channel + ':r:' + replyId, result);
      } catch (err) {
        if (replyId && _ipcReplies[replyId]) {
          _ipcReplies[replyId]({ error: err.message });
          delete _ipcReplies[replyId];
        }
      }
    };
    _ipcCh.on('main:' + channel, wrapped);
  }
  on(channel, listener) {
    const wrapped = (msg) => listener(null, ...(msg && msg.args || []));
    _ipcCh.on('main:' + channel, wrapped);
  }
  once(channel, listener) { _ipcCh.once('main:' + channel, listener); }
  removeListener(channel, listener) { _ipcCh.removeListener('main:' + channel, listener); }
  removeAllListeners(channel) { _ipcCh.removeAllListeners('main:' + channel); }
}
const ipcMain = new IpcMain();

// 为 preload 准备 renderer 事件转发器
// 主进程通过 webContents.send() 向渲染进程发消息时，
// 在 mock 模式下我们通过 _ipcCh 的 renderer:* channel 中转
_ipcCh.on('renderer:.*', () => {}); // placeholder to ensure channel exists

/* ── app ──────────────────────────────────────────────── */
const app = new EventEmitter();
let _readyResolve = null;
const _readyPromise = new Promise(r => { _readyResolve = r; });
app.whenReady = () => _readyPromise;

let _singleInstanceLock = false;
app.requestSingleInstanceLock = () => {
  if (_singleInstanceLock) return true;
  _singleInstanceLock = true;
  return true;
};

app.quit = () => process.exit(0);
app.dock = { setIcon: () => {} };
app.getPath = (name) => {
  switch (name) {
    case 'userData': return path.join(os.homedir(), 'AppData', 'Roaming', 'MCU工具箱');
    case 'temp': return os.tmpdir();
    case 'home': return os.homedir();
    case 'appData': return path.join(os.homedir(), 'AppData', 'Roaming');
    case 'exe': return process.execPath;
    case 'module': return __dirname;
    default: return path.join(os.homedir(), 'AppData', 'Roaming', 'MCU工具箱');
  }
};
app.isQuitting = false;
app.relaunch = () => {};
app.exit = (code = 0) => process.exit(code);
app.getAppName = () => 'MCU工具箱';
app.getLocale = () => 'zh-CN';
app.getName = () => 'MCU工具箱';
app.getVersion = () => '1.0.0';
app.isPackaged = false;
app.on = (event, listener) => app.addListener(event, listener);
app.once = (event, listener) => app.once(event, listener);
app.removeListener = (event, listener) => app.removeListener(event, listener);
app.removeAllListeners = (event) => app.removeAllListeners(event);
app.addListener = app.addListener.bind(app);
app.removeListener = app.removeListener.bind(app);

// 延迟触发 ready
setTimeout(() => { _readyResolve(); }, 100);

/* ── BrowserWindow ────────────────────────────────────── */
const _windows = [];
let _windowIdCounter = 1;

class BrowserWindow extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.id = _windowIdCounter++;
    this.webContents = new EventEmitter();
    this.webContents.send = (channel, ...args) => {
      // 在 mock 模式下通过 IPC 转发到 preload/渲染进程
      _ipcCh.emit('renderer:' + channel, ...args);
    };
    this.webContents.executeJavaScript = () => Promise.resolve(null);
    this.webContents.loadURL = (url) => {
      this.webContents.emit('did-start-loading');
      const self = this;
      setTimeout(() => {
        self.webContents.emit('did-finish-load');
        self.show();
        self.emit('ready-to-show');
      }, 50);
      return Promise.resolve();
    };
    this.webContents.loadFile = (filePath) => {
      return this.loadURL('file://' + filePath);
    };
    this.webContents.setWindowOpenHandler = () => ({ action: 'deny' });
    this.webContents.session = {
      setPermissionRequestHandler: () => {},
      setPermissionCheckHandler: () => true,
      setDevicePermissionHandler: () => () => true,
    };
    this.webContents.setBackgroundColor = () => {};
    this.webContents.openDevTools = () => {};
    this.webContents.reloadIgnoringCache = () => {
      this.webContents.emit('did-finish-load');
      return Promise.resolve();
    };

    this._opts = opts;
    this._visible = false;
    this._destroyed = false;
    this._menuBarVisible = true;
    this._bounds = { x: 100, y: 100, width: 1200, height: 800 };

    _windows.push(this);
    _ensureKeepAlive();
    app.emit('browser-window-created', undefined, this);
  }

  loadURL(url) {
    this._loaded = true;
    this.webContents.emit('did-start-loading');
    const self = this;
    setTimeout(() => {
      self.webContents.emit('did-finish-load');
      self.show();
      self.emit('ready-to-show');
    }, 50);
    return Promise.resolve();
  }
  loadFile(fp) { return this.loadURL('file://' + fp); }

  on(event, listener) { super.on(event, listener); }
  once(event, listener) { super.once(event, listener); }
  removeListener(event, listener) { super.removeListener(event, listener); }
  removeAllListeners(event) { super.removeAllListeners(event); }

  show() {
    this._visible = true;
    this.webContents.emit('did-show');
  }
  hide() { this._visible = false; }
  close() {
    this._destroyed = true;
    const idx = _windows.indexOf(this);
    if (idx >= 0) _windows.splice(idx, 1);
    this.webContents.emit('did-close');
    app.emit('window-all-closed');
    if (_windows.length === 0) _clearKeepAlive();
  }
  focus() {}
  setMenuBarVisibility(v) { this._menuBarVisible = v; }
  getMenuBarVisibility() { return this._menuBarVisible !== false; }
  getBounds() { return { ...this._bounds }; }
  setBounds(b) { this._bounds = { ...this._bounds, ...b }; }
  isDestroyed() { return this._destroyed; }
  setSize() {}
  setPosition() {}
  setBackgroundColor() {}
  setTitle() {}
  setIcon() {}
  maximize() {}
  unmaximize() {}
  minimize() {}
  restore() {}
  isMaximized() { return false; }
  isMinimized() { return false; }
  isFocused() { return this._visible; }
  isVisible() { return this._visible; }
  setFullScreen() {}
  isFullScreen() { return false; }
  setAlwaysOnTop() {}
  setResizable() {}
  setMovable() {}
  setMinimizable() {}
  setMaximizable() {}
  setFullScreenable() {}
  setSkipTaskbar() {}
  setKiosk() {}
  isKiosk() { return false; }
  setAutoHideMenuBar() {}
  setContentProtection() {}
  setHasShadow() {}
  setOpacity() {}
  getOpacity() { return 1; }
  setAlwaysOnTop(flag) { this._alwaysOnTop = flag; }
  isAlwaysOnTop() { return this._alwaysOnTop === true; }

  // webContents delegation
  on(event, fn) { this.webContents.on(event, fn); }
  once(event, fn) { this.webContents.once(event, fn); }
  removeListener(event, fn) { this.webContents.removeListener(event, fn); }
}

BrowserWindow.getAllWindows = () => [..._windows];
BrowserWindow.getAllWebContents = () => _windows.flatMap(w => [w.webContents]);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ── contextBridge ────────────────────────────────────── */
const contextBridge = {
  exposeInMainWorld(key, value) {
    try {
      if (typeof globalThis !== 'undefined') globalThis[key] = value;
      if (typeof window !== 'undefined') window[key] = value;
    } catch (e) {}
  },
};

/* ── 进程保活 ─────────────────────────────────────────── */
let _keepAlive = null;
function _ensureKeepAlive() {
  if (_keepAlive) return;
  _keepAlive = setInterval(() => {}, 60000);
}
function _clearKeepAlive() {
  if (_keepAlive) { clearInterval(_keepAlive); _keepAlive = null; }
}

/* ── Menu / Tray ──────────────────────────────────────── */
const Menu = {
  buildFromTemplate(template) {
    return {
      items: template.map(item => ({ ...item, click: item.click || (() => {}) })),
      popup: () => {},
    };
  },
  setApplicationMenu() {},
  getApplicationMenu() { return null; },
};

class TrayClass {
  constructor(icon) { this._icon = icon; this._listeners = {}; }
  setContextMenu(menu) { this._contextMenu = menu; }
  setToolTip(tip) {}
  on(event, fn) { this._listeners[event] = fn; }
  popUpContextMenu() {}
  destroy() { this._destroyed = true; }
}

/* ── 完整 API 导出 ────────────────────────────────────── */
const electronAPI = {
  app,
  BrowserWindow,
  ipcMain,
  ipcRenderer,
  contextBridge,
  dialog,
  Menu,
  Tray: TrayClass,
  nativeImage,
  clipboard: { writeText: () => {}, readText: () => '' },
  crashReporter: { start: () => {} },
  globalShortcut: { register: () => true, unregister: () => {}, unregisterAll: () => {} },
  net: { fetch: () => ({ then: () => ({ catch: () => {} }), catch: () => {} }) },
  powerMonitor: { queryCurrentSleepState: () => ({}), on: () => {}, off: () => {} },
  powerSaveBlocker: { start: () => 1, stop: () => {} },
  protocol: {
    registerSchemesAsPrivileged: () => {},
    registerBufferProtocol: () => {},
    registerFileProtocol: () => {},
    registerHttpProtocol: () => {},
    registerStringProtocol: () => {},
    unregisterProtocol: () => {},
    interceptFileProtocol: () => {},
    interceptHttpProtocol: () => {},
    interceptStringProtocol: () => {},
  },
  screen: {
    getDisplayMatching: () => ({}),
    getDisplayNearestPoint: () => ({}),
    getDisplayWithCursor: () => ({}),
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getPrimaryDisplay: () => ({}),
    getAllDisplays: () => [],
    setDisplayOverscan: () => {},
    setDisplayScaleFactor: () => {},
    setAccentColor: () => {},
  },
  session: { defaultSession: {} },
  shell: {
    openExternal: () => Promise.resolve({}),
    openPath: () => Promise.resolve(''),
    showItemInFolder: () => {},
    beep: () => {},
  },
  systemPreferences: { getUserDefault: () => '', setUserDefault: () => {}, getUserDefaultKey: () => '' },
  webContents: { getFocusedWebContents: () => null },
  webFrameMain: {},
};

/* ── Require Hook 安装 ────────────────────────────────── */
const _origResolve = Module._resolveFilename;
let _installed = false;

function install() {
  if (_installed) return;
  if (process.type === 'browser') return;
  _installed = true;

  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === 'electron' || request.startsWith('electron/')) {
      return require.resolve('./electron-api');
    }
    return _origResolve.call(this, request, parent, isMain, options);
  };

  // 清除旧缓存
  try { delete require.cache[require.resolve('electron')]; } catch (e) {}
  try {
    const pkg = require.resolve('electron/package.json');
    delete require.cache[pkg];
  } catch (e) {}

  // 预填充缓存
  require.cache[require.resolve('./electron-api')] = {
    id: require.resolve('./electron-api'),
    filename: require.resolve('./electron-api'),
    loaded: true,
    exports: electronAPI,
  };

  console.log('[electron-polyfill] require("electron") hook installed');
}

install();

// 延迟安装 hook：让 Electron 二进制先 patch require('electron')，
// 确保主进程代码首次 require('electron') 拿到真实 API。
// 延迟后再装 polyfill hook，为后续/preload/等兜底。
setImmediate(install);

module.exports = electronAPI;
