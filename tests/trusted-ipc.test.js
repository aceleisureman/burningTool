'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { installTrustedIpcGuard } = require('../src/main/core/trusted-ipc');

test('trusted IPC guard accepts only the active main window sender', async () => {
  const handlers = new Map();
  const ipcMain = { handle: (channel, listener) => handlers.set(channel, listener) };
  const webContents = { getURL: () => 'file:///app/index.html' };
  const win = { isDestroyed: () => false, webContents };
  installTrustedIpcGuard(ipcMain, () => win, (url) => url.startsWith('file:///app/'));
  ipcMain.handle('demo', (_event, value) => value * 2);

  const handler = handlers.get('demo');
  assert.strictEqual(await handler({ sender: webContents, senderFrame: { url: webContents.getURL() } }, 3), 6);
  assert.throws(
    () => handler({ sender: { getURL: webContents.getURL }, senderFrame: { url: webContents.getURL() } }, 3),
    /untrusted IPC/
  );
});
