'use strict';

const vscode = require('vscode');
const { t } = require('./i18n');

function createStatusBar() {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  item.command = 'stm32Flash.openOutput';
  item.text = t('status.idle');
  item.tooltip = 'MCU-Assistant';
  item.show();

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

  return {
    item,
    setIdle,
    setBusy,
    setResult
  };
}

module.exports = { createStatusBar };
