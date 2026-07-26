const { ipcMain, app } = require('electron');
const { loadConfig } = require('../core/config');
const { registerSerial } = require('../devices/serial');
const { registerMqtt } = require('../devices/mqtt');
const { checkProbeInfo, readChipInfo, hardwareDebugCommand } = require('../flash/flasher');
const { analyzeFirmware } = require('../firmware/analyzer');
const { readRamLog } = require('../ramlog/ramlog');
const windows = require('../windows');

function pushToRenderer(channel, payload) {
  const window = windows.getMainWindow();
  if (window) window.webContents.send(channel, payload);
}

function registerDebugIpc() {
  ipcMain.handle('check-probe', async () => checkProbeInfo(loadConfig()));
  ipcMain.handle('read-chip-info', async () => readChipInfo(loadConfig()));
  ipcMain.handle('hardware-debug-command', async (_e, action, opts) => hardwareDebugCommand(action, opts || {}, loadConfig()));
  ipcMain.handle('analyze-firmware', async (_e, projectDir) => analyzeFirmware(projectDir, loadConfig()));
  ipcMain.handle('read-ram-log', async (_e, opts) => readRamLog(opts || {}, loadConfig()));

  registerSerial(ipcMain, pushToRenderer);
  registerMqtt(ipcMain, app, pushToRenderer);
}

module.exports = { registerDebugIpc };
