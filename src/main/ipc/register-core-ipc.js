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
const profile = require('../core/startup-profile');
const memoryMonitor = require('../core/memory-monitor');

function registerCoreIpc({ send }) {
  const MAX_CONFIG_BYTES = 8 * 1024 * 1024;
  const MAX_CLIPBOARD_CHARS = 4 * 1024 * 1024;
  // 手动检查更新的在途标记：避免连点造成多路并发检查/下载
  let updateCheckInFlight = false;
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

  // 检查更新：立即返回已受理的 ack，实际检查/下载在后台进行，
  // 结果通过 'update-status' 推送（渲染端另有轮询兜底）。
  // 这样即便下载大安装包，也不会让主进程一直挂着一个待完成的 IPC 调用，
  // 更不会阻塞主程序其它 IPC。
  ipcMain.handle('update-check', () => {
    if (updateCheckInFlight) return { ok: true, note: 'already-checking', state: updater.getState() };
    updateCheckInFlight = true;
    Promise.resolve()
      .then(() => updater.checkNow())
      .catch(() => {})
      .finally(() => { updateCheckInFlight = false; });
    return { ok: true, note: 'started', state: updater.getState() };
  });
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

  // 启动性能探针：渲染层在「挂载完成 / 首屏可见」时刻回报里程碑，
  // 统一并入主进程时间轴；仅在 MCU_STARTUP_PROFILE=1 时有效（否则 no-op）。
  // 需要时可在主进程日志里看到 renderer:* 阶段。
  ipcMain.handle('startup-mark', (_e, name, rendererAt) => {
    profile.rendererMark(String(name || ''), Number(rendererAt));
    // 渲染层首帧绘制完成 → 打印一次完整启动报告（仅 MCU_STARTUP_PROFILE=1 时有效）
    if (String(name) === 'firstPaint') profile.printReport('启动性能（主进程 + 渲染层）');
    return true;
  });
  ipcMain.handle('startup-profile', () => profile.snapshot());

  // ── 内存监控（设置页采样用）──
  // 采集各进程工作集 / 峰值 / 私有字节 + 主进程 JS 堆，供排查内存增长与优化对比。
  ipcMain.handle('app-memory-stats', () => memoryMonitor.collect());
  ipcMain.handle('app-memory-gc', () => memoryMonitor.forceGc());

  return { startHttpApiFromConfig };
}

module.exports = { registerCoreIpc };
