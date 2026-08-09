const { ipcMain, clipboard } = require('electron');
const {
  PLATFORM_TC,
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig
} = require('../core/config');
const { readHostSystemInfo } = require('../toolchain/toolchain');
const httpApi = require('../core/http-server');
const updater = require('../core/updater');
const { loadMqttHistory, saveMqttHistory } = require('../core/mqtt-history-store');

function registerCoreIpc({ send }) {
  const MAX_CONFIG_BYTES = 8 * 1024 * 1024;
  const MAX_CLIPBOARD_CHARS = 4 * 1024 * 1024;
  async function startHttpApiFromConfig() {
    const cfg = loadConfig();
    const api = cfg.httpApi || {};
    if (api.enabled !== true) return;
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
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('http-api-stop', async () => {
    await httpApi.stop();
    const cfg = loadConfig();
    saveConfig(Object.assign({}, cfg, { httpApi: Object.assign({}, cfg.httpApi || {}, { enabled: false }) }));
    return { ok: true };
  });

  ipcMain.handle('update-check', () => updater.checkNow());
  ipcMain.handle('update-status', () => updater.getState());
  ipcMain.handle('update-install', () => updater.quitAndInstall());

  ipcMain.handle('clipboard-write', (_e, text) => {
    const value = String(text || '');
    if (value.length > MAX_CLIPBOARD_CHARS) throw new Error('Clipboard content is too large');
    clipboard.writeText(value);
    return true;
  });
  ipcMain.handle('get-config', () => loadConfig());
  ipcMain.handle('save-config', (_e, cfg) => {
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('Invalid config payload');
    if (Buffer.byteLength(JSON.stringify(cfg), 'utf8') > MAX_CONFIG_BYTES) throw new Error('Config payload is too large');
    return saveConfig(cfg);
  });
  ipcMain.handle('get-mqtt-history', () => loadMqttHistory());
  ipcMain.handle('save-mqtt-history', (_e, data) => saveMqttHistory(data));
  ipcMain.handle('reset-config', () => {
    const cur = loadConfig();
    return saveConfig(Object.assign({}, DEFAULT_CONFIG, { recentProjects: cur.recentProjects }), { immediate: true });
  });
  ipcMain.handle('get-platform', () => process.platform);
  ipcMain.handle('get-platform-toolchain', () => Object.assign({}, PLATFORM_TC, { systemInfo: readHostSystemInfo() }));

  return { startHttpApiFromConfig };
}

module.exports = { registerCoreIpc };
