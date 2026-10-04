const { ipcMain } = require('electron');
const { loadConfig } = require('../core/config');
const profile = require('../core/startup-profile');
const {
  toolsDir,
  isToolchainInstalled,
  defaultToolchainStatus,
  installToolchain,
  installDefaultToolchain,
  getSystemPathStatus,
  syncSystemPath,
  removeSystemPath,
  installLocalStcgal,
  installLocalEsptool
} = require('../toolchain/toolchain');

function registerToolchainIpc({ send }) {
  ipcMain.handle('toolchain-status', () => profile.span('ipc:toolchain-status', () => ({ installed: isToolchainInstalled('arm-gcc'), dir: toolsDir() })));
  ipcMain.handle('install-toolchain', async () => {
    try {
      return await installToolchain('arm-gcc');
    } catch (e) {
      send(`[环境] ✗ 安装失败: ${e.message}`, 'error');
      return { installed: false, error: e.message };
    }
  });

  // 注意：defaultToolchainStatus 内部是 5 次串行 spawnSync（gcc/make/pyocd/openocd/busybox
  // 版本探测，单次 timeout 2500ms）。这是启动期最可能冻结 event loop 的同步任务，
  // 故显式打点，便于用 MCU_STARTUP_PROFILE=1 定位。
  ipcMain.handle('default-toolchain-status', () => profile.span('ipc:default-toolchain-status', () => defaultToolchainStatus()));
  ipcMain.handle('toolchain-system-path-status', () => profile.span('ipc:toolchain-system-path-status', () => getSystemPathStatus()));
  ipcMain.handle('toolchain-system-path-add', () => syncSystemPath());
  ipcMain.handle('toolchain-system-path-remove', () => removeSystemPath());

  ipcMain.handle('install-default-toolchain', async (_e, opts) => {
    try {
      return await installDefaultToolchain(loadConfig(), opts || {});
    } catch (e) {
      const msg = e && (e.code || e.message) ? `${e.code ? `${e.code}: ` : ''}${e.message || ''}` : String(e);
      send(`[环境] ✗ 默认工具链安装失败: ${msg}`, 'error');
      send('[环境] 可尝试填写下载加速镜像，或稍后重新下载', 'info');
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('install-stcgal', async (_e, opts) => {
    try {
      return await installLocalStcgal(!!(opts && opts.force));
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  ipcMain.handle('install-esptool', async (_e, opts) => {
    try {
      return await installLocalEsptool(!!(opts && opts.force));
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

module.exports = { registerToolchainIpc };
