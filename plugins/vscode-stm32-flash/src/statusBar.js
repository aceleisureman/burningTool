'use strict';

const vscode = require('vscode');
const { t } = require('./i18n');

function createStatusBar() {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  item.command = 'stm32Flash.openOutput';
  item.text = t('status.idle');
  item.tooltip = 'MCU-Assistant';
  item.show();

  const portItem = vscode.window.createStatusBarItem('stm32Flash.port', vscode.StatusBarAlignment.Left, 49);
  portItem.name = 'MCU-Assistant: 选择串口';
  portItem.command = 'stm32Flash.selectSerialPort';
  portItem.tooltip = '选择烧录串口';

  const buildItem = vscode.window.createStatusBarItem('stm32Flash.build', vscode.StatusBarAlignment.Left, 48);
  buildItem.name = 'MCU-Assistant: 编译';
  buildItem.text = '$(tools)';
  buildItem.command = 'stm32Flash.build';
  buildItem.tooltip = '编译工程';

  const flashItem = vscode.window.createStatusBarItem('stm32Flash.flash', vscode.StatusBarAlignment.Left, 47);
  flashItem.name = 'MCU-Assistant: 烧录';
  flashItem.text = '$(arrow-up)';
  flashItem.command = 'stm32Flash.flash';
  flashItem.tooltip = '烧录固件';

  const buildAndFlashItem = vscode.window.createStatusBarItem('stm32Flash.buildAndFlash', vscode.StatusBarAlignment.Left, 46);
  buildAndFlashItem.name = 'MCU-Assistant: 一键编译烧录';
  buildAndFlashItem.text = '$(run-all)';
  buildAndFlashItem.command = 'stm32Flash.buildAndFlash';
  buildAndFlashItem.tooltip = '一键编译并烧录';

  for (const actionItem of [portItem, buildItem, flashItem, buildAndFlashItem]) actionItem.show();

  let lastResult = '';

  function setIdle(msg) {
    if (msg) {
      item.text = `$(chip) ${msg}`;
      if (String(msg).includes(t('status.select')) || String(msg).includes('请选择工程') || String(msg).includes('Select project')) {
        item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        return;
      }
    } else if (lastResult === 'ok') {
      item.text = t('status.done');
    } else if (lastResult === 'err') {
      item.text = t('status.fail');
    } else {
      item.text = t('status.idle');
    }
    item.backgroundColor = undefined;
  }

  function setBusy(label) {
    item.text = `$(sync~spin) ${label || t('status.busy')}`;
    item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  function setResult(ok) {
    lastResult = ok ? 'ok' : 'err';
    item.text = ok ? t('status.done') : t('status.fail');
    item.backgroundColor = ok
      ? undefined
      : new vscode.ThemeColor('statusBarItem.errorBackground');
  }

  function setPort(port) {
    const value = String(port || '').trim();
    portItem.text = value ? `$(plug) ${value}` : '$(plug) Auto';
    portItem.tooltip = value ? `当前烧录串口：${value}` : '选择烧录串口（当前为自动检测）';
  }

  setPort('');

  return {
    item,
    items: [item, portItem, buildItem, flashItem, buildAndFlashItem],
    setIdle,
    setBusy,
    setResult,
    setPort
  };
}

module.exports = { createStatusBar };
