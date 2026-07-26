const { ipcMain } = require('electron');
const { loadConfig } = require('../core/config');
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
  ipcMain.handle('toolchain-system-path-status', () => getSystemPathStatus());
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
