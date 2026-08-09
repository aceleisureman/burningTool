'use strict';

function installTrustedIpcGuard(ipcMain, getTrustedWindow, isTrustedUrl) {
  if (!ipcMain || ipcMain.__trustedHandlerGuardInstalled) return;
  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => originalHandle(channel, (event, ...args) => {
    const win = typeof getTrustedWindow === 'function' ? getTrustedWindow() : null;
    const sender = event && event.sender;
    const senderUrl = event && event.senderFrame && event.senderFrame.url
      ? event.senderFrame.url
      : (sender && typeof sender.getURL === 'function' ? sender.getURL() : '');
    const trusted = !!win
      && !win.isDestroyed()
      && sender === win.webContents
      && (typeof isTrustedUrl !== 'function' || isTrustedUrl(senderUrl));
    if (!trusted) throw new Error(`Rejected untrusted IPC call: ${channel}`);
    return listener(event, ...args);
  });
  Object.defineProperty(ipcMain, '__trustedHandlerGuardInstalled', { value: true });
}

module.exports = { installTrustedIpcGuard };
