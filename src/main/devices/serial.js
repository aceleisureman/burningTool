// 串口调试后端（serialport）：枚举 / 打开 / 写 / 关，数据经注入的 push 推送到渲染端。
// 加载错误日志走 bus；具体通道推送由 main.js 注入的 push(channel, payload) 完成。
const bus = require('../core/bus');

let _SerialPort = null;
let activeSerial = null;

function loadSerialPort() {
  if (_SerialPort !== null) return _SerialPort;
  try { _SerialPort = require('serialport').SerialPort || null; }
  catch (e) { _SerialPort = false; bus.send('[串口] serialport 模块加载失败: ' + e.message + '（请在工程目录执行 npm install serialport 并 npx @electron/rebuild）', 'error'); }
  return _SerialPort;
}

function registerSerial(ipcMain, push) {
  const pushSerial = typeof push === 'function' ? push : (() => {});

  ipcMain.handle('serial-list', async () => {
    const SP = loadSerialPort();
    if (!SP) return { ok: false, error: 'serialport 未安装或未为 Electron 重建' };
    try {
      const ports = await SP.list();
      return { ok: true, ports: ports.map((p) => ({
        path: p.path || '',
        friendlyName: p.friendlyName || '',
        manufacturer: p.manufacturer || '',
        serialNumber: p.serialNumber || '',
        vendorId: p.vendorId || '',
        productId: p.productId || '',
        pnpId: p.pnpId || ''
      })) };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('serial-open', async (_e, opts) => {
    const SP = loadSerialPort();
    if (!SP) return { ok: false, error: 'serialport 未安装或未为 Electron 重建' };
    opts = opts || {};
    if (!opts.path) return { ok: false, error: '未指定串口' };
    try {
      if (activeSerial && activeSerial.isOpen) await new Promise((r) => activeSerial.close(() => r()));
      activeSerial = null;
      const port = new SP({
        path: opts.path,
        baudRate: Number(opts.baudRate) || 115200,
        dataBits: Number(opts.dataBits) || 8,
        stopBits: Number(opts.stopBits) || 1,
        parity: opts.parity || 'none',
        autoOpen: false
      });
      await new Promise((resolve, reject) => port.open((err) => (err ? reject(err) : resolve())));
      activeSerial = port;
      port.on('data', (buf) => pushSerial('serial-data', Array.from(buf)));
      port.on('close', () => pushSerial('serial-closed'));
      port.on('error', (err) => pushSerial('serial-error', err && err.message ? err.message : String(err)));
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('serial-write', async (_e, data) => {
    if (!activeSerial || !activeSerial.isOpen) return { ok: false, error: '串口未连接' };
    try {
      await new Promise((resolve, reject) => activeSerial.write(Buffer.from(data || []), (err) => (err ? reject(err) : resolve())));
      await new Promise((resolve) => activeSerial.drain(() => resolve()));
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('serial-close', async () => {
    try { if (activeSerial && activeSerial.isOpen) await new Promise((r) => activeSerial.close(() => r())); activeSerial = null; return { ok: true }; }
    catch (e) { activeSerial = null; return { ok: false, error: e.message }; }
  });
}

module.exports = { registerSerial };
