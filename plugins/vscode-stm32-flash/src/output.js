'use strict';

const vscode = require('vscode');

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** HH:mm:ss */
function formatTime(d = new Date()) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function parseCategory(text) {
  const match = /^\[([^\]]+)\]\s*(.*)$/.exec(text);
  if (!match) return { category: '', message: text };
  return { category: match[1].trim().toUpperCase(), message: match[2] };
}

function marker(type) {
  if (type === 'error') return '✕';
  if (type === 'success') return '✓';
  if (type === 'warn') return '!';
  if (type === 'progress') return '…';
  return '·';
}

function createOutput() {
  const channel = vscode.window.createOutputChannel('MCU-Assistant');
  let openGroup = '';

  function closeGroup() {
    if (!openGroup) return;
    channel.appendLine('         └─');
    openGroup = '';
  }

  function append(text, type = 'info') {
    const line = String(text == null ? '' : text);
    if (!line) return;
    const parsed = parseCategory(line);

    if (parsed.category === 'PIO') {
      if (openGroup !== 'PIO') {
        closeGroup();
        channel.appendLine(`${formatTime()} ┌─ PlatformIO`);
        openGroup = 'PIO';
      }
      const branch = type === 'error' || type === 'warn' || type === 'success' ? '├─' : '│ ';
      const prefix = type === 'info' ? '' : `${marker(type)} `;
      channel.appendLine(`         ${branch} ${prefix}${parsed.message}`);
      return;
    }

    closeGroup();
    if (type === 'step') {
      const title = parsed.category ? `${parsed.category} · ${parsed.message}` : parsed.message;
      channel.appendLine('');
      channel.appendLine(`${formatTime()} ▶ ${title || line}`);
      channel.appendLine('         ' + '─'.repeat(64));
      return;
    }

    const category = parsed.category ? `${parsed.category.padEnd(8)} ` : '';
    channel.appendLine(`${formatTime()} ${marker(type)} ${category}${parsed.message}`);
  }

  return {
    channel,
    append,
    show: (preserveFocus = true) => channel.show(preserveFocus),
    clear: () => {
      openGroup = '';
      channel.clear();
    }
  };
}

module.exports = { createOutput, formatTime, parseCategory };
