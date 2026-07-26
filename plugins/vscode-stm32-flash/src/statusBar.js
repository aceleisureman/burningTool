'use strict';

const vscode = require('vscode');

function createStatusBar() {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  item.command = 'stm32Flash.openOutput';
  item.text = '$(chip) MCU-Assistant';
  item.tooltip = 'MCU-Assistant 固件烧录';
  item.show();

  let lastResult = '';

  function setIdle(msg) {
    if (msg) {
      item.text = `$(chip) ${msg}`;
      if (String(msg).includes('请选择工程')) {
        item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        return;
      }
    } else if (lastResult === 'ok') {
      item.text = '$(check) MCU-Assistant 完成';
    } else if (lastResult === 'err') {
      item.text = '$(error) MCU-Assistant 失败';
    } else {
      item.text = '$(chip) MCU-Assistant';
    }
    item.backgroundColor = undefined;
  }

  function setBusy(label) {
    item.text = `$(sync~spin) ${label || 'MCU-Assistant 运行中…'}`;
    item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  function setResult(ok) {
    lastResult = ok ? 'ok' : 'err';
    item.text = ok ? '$(check) MCU-Assistant 成功' : '$(error) MCU-Assistant 失败';
    item.backgroundColor = ok
      ? undefined
      : new vscode.ThemeColor('statusBarItem.errorBackground');
  }

  return {
    item,
    setIdle,
    setBusy,
    setResult
  };
}

module.exports = { createStatusBar };
