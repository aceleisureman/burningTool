// 加载 polyfill（install() 内部用 setImmediate 延迟执行，
// 先让 Electron 二进制 patch require('electron')，主进程代码首次 require 拿到真实 API）
require('./electron-api');
const { app, BrowserWindow, ipcMain, dialog, nativeImage, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  PLATFORM_TC,
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  addRecent,
  removeRecent
} = require('./core/config');
const bus = require('./core/bus');
const {
  readHostSystemInfo,
  toolsDir,
  isToolchainInstalled,
  defaultToolchainStatus,
  installToolchain,
  installDefaultToolchain,
  installLocalStcgal,
  installLocalEsptool
} = require('./toolchain/toolchain');
const { registerSerial } = require('./devices/serial');
const { registerMqtt } = require('./devices/mqtt');
const {
  checkProbeInfo,
  readChipInfo,
  hardwareDebugCommand,
  findKeilProject,
  findIocFile,
  detectBuildSystem,
  generateMakefile,
  compile,
  flash
} = require('./flash/flasher');
const {
  stc51ToolStatus,
  flashStc51
} = require('./flash/stc51');
const {
  esp32ToolStatus,
  flashEsp32
} = require('./flash/esp32');
const { analyzeFirmware } = require('./firmware/analyzer');
const { readRamLog } = require('./ramlog/ramlog');
const httpApi = require('./core/http-server');
const updater = require('./core/updater');
const windows = require('./windows');

const APP_ICON = path.join(__dirname, '..', '..', 'assets', 'icons', 'icon.png');
/* ── 日志助手 ─────────────────────────────────────────── */
function send(text, type = 'info') {
  const w = windows.getMainWindow();
  if (w) w.webContents.send('log', { text, type });
}

// 带 key 的进度日志：渲染端按 key 原地更新同一行，不刷屏
function sendProgress(key, text) {
  const w = windows.getMainWindow();
  if (w) w.webContents.send('log', { text, type: 'progress', key });
}

// 驱动设置面板里的进度条
function sendDownloadProgress(label, percent) {
  const w = windows.getMainWindow();
  if (w) w.webContents.send('download-progress', { label, percent });
}

// 把日志/进度输出实现注入 bus，供 downloader 等子模块复用
bus.setSinks({ send, sendProgress, sendDownloadProgress });

// 单实例：已运行则聚焦已有窗口，不再开新实例
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => windows.focusOrCreate());
  app.whenReady().then(() => {
    if (process.platform === 'darwin' && app.dock) {
      const dockImg = nativeImage.createFromPath(APP_ICON);
      if (!dockImg.isEmpty()) app.dock.setIcon(dockImg);
    }
    windows.createWindow();
    startHttpApiFromConfig();
    updater.checkOnStartup();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) windows.createWindow();
  });
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { try { httpApi.stop(); } catch {} });

/* ── 本地 HTTP API：启动 + IPC ────────────────────────── */
async function startHttpApiFromConfig() {
  const cfg = loadConfig();
  const api = cfg.httpApi || {};
  if (api.enabled === false) return;
  try {
    const bound = await httpApi.start({ host: api.host || '127.0.0.1', port: api.port || 27080 });
    send(`[HTTP-API] 已启用: http://${bound.host}:${bound.port}  (POST /api/build-flash 一键编译烧录)`, 'info');
  } catch (e) {
    send(`[HTTP-API] ✗ 启动失败: ${e.message}`, 'error');
  }
}
ipcMain.handle('http-api-status', () => httpApi.status());
ipcMain.handle('http-api-start', async (_e, opts) => {
  try {
    const cfg = loadConfig();
    const api = Object.assign({}, cfg.httpApi || {}, opts || {});
    const bound = await httpApi.start({ host: api.host || '127.0.0.1', port: api.port || 27080 });
    saveConfig(Object.assign({}, cfg, { httpApi: Object.assign({}, api, { enabled: true }) }));
    return { ok: true, bind: bound };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('http-api-stop', async () => {
  await httpApi.stop();
  const cfg = loadConfig();
  saveConfig(Object.assign({}, cfg, { httpApi: Object.assign({}, cfg.httpApi || {}, { enabled: false }) }));
  return { ok: true };
});

/* ── 自动更新（GitHub Releases）───────────────────────── */
ipcMain.handle('update-check', () => updater.checkNow());
ipcMain.handle('update-status', () => updater.getState());
ipcMain.handle('update-install', () => updater.quitAndInstall());

/* ── IPC ──────────────────────────────────────────────── */

ipcMain.handle('clipboard-write', (_e, text) => { clipboard.writeText(String(text || '')); return true; });
ipcMain.handle('toolchain-status', () => ({ installed: isToolchainInstalled('arm-gcc'), dir: toolsDir() }));
ipcMain.handle('install-toolchain', async () => {
  try {
    return await installToolchain('arm-gcc');
  } catch (e) {
    send(`[环境] ✗ 安装失败: ${e.message}`, 'error');
    return { installed: false, error: e.message };
  }
});

ipcMain.handle('default-toolchain-status', () => defaultToolchainStatus());
ipcMain.handle('install-default-toolchain', async (_e, opts) => {
  try {
    return await installDefaultToolchain(loadConfig(), opts || {});
  } catch (e) {
    const msg = e && (e.code || e.message) ? `${e.code ? e.code + ': ' : ''}${e.message || ''}` : String(e);
    send(`[环境] ✗ 默认工具链安装失败: ${msg}`, 'error');
    send('[环境] 可尝试填写下载加速镜像，或稍后重新下载', 'info');
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('get-config', () => loadConfig());
ipcMain.handle('save-config', (_e, cfg) => saveConfig(cfg));
ipcMain.handle('get-platform', () => process.platform);
ipcMain.handle('get-platform-toolchain', () => Object.assign({}, PLATFORM_TC, { systemInfo: readHostSystemInfo() }));
ipcMain.handle('check-probe', async () => checkProbeInfo(loadConfig()));
ipcMain.handle('read-chip-info', async () => readChipInfo(loadConfig()));
ipcMain.handle('hardware-debug-command', async (_e, action, opts) => hardwareDebugCommand(action, opts || {}, loadConfig()));
ipcMain.handle('analyze-firmware', async (_e, projectDir) => analyzeFirmware(projectDir, loadConfig()));
ipcMain.handle('read-ram-log', async (_e, opts) => readRamLog(opts || {}, loadConfig()));
ipcMain.handle('stc51-tool-status', async () => stc51ToolStatus(loadConfig()));
ipcMain.handle('install-stcgal', async (_e, opts) => {
  try {
    return await installLocalStcgal(!!(opts && opts.force));
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('flash-stc51', async (_e, opts) => flashStc51(opts || {}, loadConfig()));
ipcMain.handle('esp32-tool-status', async () => esp32ToolStatus(loadConfig()));
ipcMain.handle('install-esptool', async (_e, opts) => {
  try {
    return await installLocalEsptool(!!(opts && opts.force));
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('flash-esp32', async (_e, opts) => flashEsp32(opts || {}, loadConfig()));
ipcMain.handle('export-quickcmds', async (_e, data) => {
  const r = await dialog.showSaveDialog(windows.getMainWindow(), {
    title: '导出快捷指令', defaultPath: 'quick-commands.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  try { fs.writeFileSync(r.filePath, JSON.stringify(data || [], null, 2), 'utf8'); return { ok: true, path: r.filePath }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('import-quickcmds', async () => {
  const r = await dialog.showOpenDialog(windows.getMainWindow(), {
    title: '导入快捷指令', properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true };
  try { return { ok: true, data: JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
/* ── 串口调试（serialport 后端）：注册 IPC，数据经 pushToRenderer 推送到渲染端 ── */
function pushToRenderer(channel, payload) {
  const w = windows.getMainWindow();
  if (w) w.webContents.send(channel, payload);
}
registerSerial(ipcMain, pushToRenderer);

/* ── MQTT 调试（mqtt.js 后端）：注册 IPC，状态/消息经 pushToRenderer 推送到渲染端 ── */
registerMqtt(ipcMain, app, pushToRenderer);

ipcMain.handle('reset-config', () => {
  const cur = loadConfig();
  // 恢复默认路径/设置，但保留历史项目
  return saveConfig(Object.assign({}, DEFAULT_CONFIG, { recentProjects: cur.recentProjects }));
});

/* 历史项目 */
ipcMain.handle('get-recent', () => loadConfig().recentProjects || []);
ipcMain.handle('add-recent', (_e, dir) => addRecent(dir));
ipcMain.handle('remove-recent', (_e, dir) => removeRecent(dir));
function dirInfo(dir) {
  const exists = !!dir && fs.existsSync(dir);
  const hasMakefile = exists && fs.existsSync(path.join(dir, 'Makefile'));
  const keilProj = exists ? findKeilProject(dir) : null;
  const hasKeil = !!keilProj;
  const iocFile = exists ? findIocFile(dir) : null;
  return {
    dir,
    exists,
    hasMakefile,
    hasKeil,
    keilProject: keilProj ? (path.relative(dir, keilProj) || path.basename(keilProj)) : '',
    hasIoc: !!iocFile,
    iocFile: iocFile ? (path.relative(dir, iocFile) || path.basename(iocFile)) : '',
    // 在 auto 模式下该目录会用哪种编译方式
    buildSystem: exists ? detectBuildSystem(dir, loadConfig()) : null
  };
}

ipcMain.handle('check-dir', (_e, dir) => dirInfo(dir));

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(windows.getMainWindow(), { properties: ['openDirectory'] });
  if (result.canceled) return null;
  const dir = result.filePaths[0];
  const info = dirInfo(dir);
  // 有 Makefile / Keil 工程 / CubeMX 工程(.ioc) 都记入历史
  if (info.hasMakefile || info.hasKeil || info.hasIoc) addRecent(dir);
  return info;
});

ipcMain.handle('select-firmware-file', async () => {
  const result = await dialog.showOpenDialog(windows.getMainWindow(), {
    title: '选择固件文件',
    properties: ['openFile'],
    filters: [
      { name: '固件文件', extensions: ['hex', 'ihx', 'bin', 'elf', 'axf'] },
      { name: '51 / STC 固件', extensions: ['hex', 'ihx', 'bin'] },
      { name: '全部文件', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePaths || !result.filePaths[0]) return null;
  const file = result.filePaths[0];
  try {
    const stat = fs.statSync(file);
    return { path: file, name: path.basename(file), size: stat.size, ext: path.extname(file).toLowerCase() };
  } catch (e) {
    return { path: file, name: path.basename(file), size: 0, ext: path.extname(file).toLowerCase(), error: e.message };
  }
});

ipcMain.handle('generate-makefile', async (_e, projectDir) => {
  addRecent(projectDir);
  try {
    return await generateMakefile(projectDir, loadConfig());
  } catch (e) {
    send(`[生成] ✗ 异常: ${e.message}`, 'error');
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('build', async (_e, projectDir) => {
  addRecent(projectDir);
  const ok = await compile(projectDir, loadConfig());
  return { success: ok };
});

ipcMain.handle('flash', async (_e, projectDir) => {
  addRecent(projectDir);
  const ok = await flash(projectDir, loadConfig());
  return { success: ok };
});

ipcMain.handle('build-and-flash', async (_e, projectDir) => {
  addRecent(projectDir);
  const cfg = loadConfig();
  const buildOk = await compile(projectDir, cfg);
  if (!buildOk) return { buildOk: false, flashOk: false };
  const flashOk = await flash(projectDir, cfg);
  return { buildOk, flashOk };
});
