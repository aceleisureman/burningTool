'use strict';

const vscode = require('vscode');
const { updateSetting } = require('./config');
const { listPioDevices } = require('./platforms/esp32');

function listSerialPorts() {
  return listPioDevices(undefined, true);
}

async function selectSerialPort() {
  const devices = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'MCU-Assistant: 正在检测串口' },
    () => listSerialPorts()
  );
  const items = [
    { label: '$(debug-disconnect) 自动选择', description: '由烧录工具自动检测', port: '' },
    ...devices.map((device) => ({
      label: `$(plug) ${device.port}`,
      description: device.description || device.hwid,
      detail: device.hwid,
      port: device.port
    })),
    { label: '$(edit) 手动输入...', description: '输入串口名称或设备路径', manual: true }
  ];

  const picked = await vscode.window.showQuickPick(items, {
    title: 'MCU-Assistant: 选择烧录串口',
    placeHolder: devices.length ? '选择串口' : '未自动检测到串口，可手动输入',
    matchOnDescription: true,
    matchOnDetail: true
  });
  if (!picked) return undefined;

  let port = picked.port;
  if (picked.manual) {
    port = await vscode.window.showInputBox({
      title: 'MCU-Assistant: 输入烧录串口',
      prompt: '例如 COM3、/dev/ttyUSB0 或 /dev/cu.usbserial-1234',
      validateInput: (value) => value.trim() ? null : '串口不能为空'
    });
    if (port === undefined) return undefined;
    port = port.trim();
  }

  await updateSetting('serialPort', port || '');
  return port || '';
}

module.exports = { listSerialPorts, selectSerialPort };
