'use strict';

const vscode = require('vscode');

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** HH:mm:ss.SSS */
function formatTime(d = new Date()) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function createOutput() {
  const channel = vscode.window.createOutputChannel('MCU-Assistant');
  /** @type {Map<string, number>} */
  const progressLines = new Map();

  function append(text, type = 'info', key) {
    const line = String(text == null ? '' : text);
    if (!line) return;
    const mark =
      type === 'error' ? '✗' :
      type === 'success' ? '✓' :
      type === 'warn' ? '⚠' :
      type === 'step' ? '▶' :
      type === 'progress' ? '…' : '·';
    if (type === 'progress' && key) {
      progressLines.set(key, Date.now());
    }
    channel.appendLine(`${formatTime()} ${mark} ${line}`);
    // 每次 append 后自动滚到底（preserveFocus=true 不抢焦点）
    channel.show(true);
  }

  return {
    channel,
    append,
    show: (preserveFocus = true) => channel.show(preserveFocus),
    clear: () => channel.clear()
  };
}

module.exports = { createOutput, formatTime };
