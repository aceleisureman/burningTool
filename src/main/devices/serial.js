// 串口调试后端（serialport）：枚举 / 打开 / 写 / 关，数据经注入的 push 推送到渲染端。
// 加载错误日志走 bus；具体通道推送由 main.js 注入的 push(channel, payload) 完成。
const bus = require('../core/bus');

let _SerialPort = null;
let activeSerial = null;
let serialGeneration = 0;
let serialOperation = Promise.resolve();

const MAX_SERIAL_WRITE_BYTES = 1024 * 1024;
const MAX_SERIAL_BATCH_BYTES = 64 * 1024;
const MAX_SERIAL_PATH_CHARS = 1024;
const SERIAL_PARITIES = new Set(['none', 'even', 'odd', 'mark', 'space']);

function enqueueSerialOperation(task) {
  const run = serialOperation.then(task, task);
  serialOperation = run.catch(() => {});
  return run;
}

function closePort(port) {
  if (!port || !port.isOpen) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    try { port.close(() => done()); } catch { done(); }
  });
}

function readInteger(value, fallback, min, max, name) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} 必须是 ${min}-${max} 的整数`);
  return n;
}

function readStopBits(value) {
  if (value == null || value === '') return 1;
  const n = Number(value);
  if (n !== 1 && n !== 1.5 && n !== 2) throw new Error('停止位必须是 1、1.5 或 2');
  return n;
}

function readSerialPayload(data) {
  if (data == null) return Buffer.alloc(0);
  let size;
  if (Array.isArray(data)) size = data.length;
  else if (data instanceof ArrayBuffer) size = data.byteLength;
  else if (ArrayBuffer.isView(data)) size = data.byteLength;
  else throw new Error('串口数据格式无效');
  if (size > MAX_SERIAL_WRITE_BYTES) throw new Error(`单次写入不能超过 ${MAX_SERIAL_WRITE_BYTES} 字节`);
  if (Array.isArray(data)) {
    for (const byte of data) {
      if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw new Error('串口数据包含无效字节');
    }
    return Buffer.from(data);
  }
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

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
    try {
      const path = typeof opts.path === 'string' ? opts.path.trim() : '';
      if (!path) throw new Error('未指定串口');
      if (path.length > MAX_SERIAL_PATH_CHARS) throw new Error(`串口路径不能超过 ${MAX_SERIAL_PATH_CHARS} 个字符`);
      const baudRate = readInteger(opts.baudRate, 115200, 50, 12000000, '波特率');
      const dataBits = readInteger(opts.dataBits, 8, 5, 8, '数据位');
      const stopBits = readStopBits(opts.stopBits);
      const parity = typeof opts.parity === 'string' ? opts.parity.toLowerCase() : 'none';
      if (!SERIAL_PARITIES.has(parity)) throw new Error('校验位必须是 none、even、odd、mark 或 space');
      return await enqueueSerialOperation(async () => {
        const generation = ++serialGeneration;
        const previous = activeSerial;
        activeSerial = null;
        await closePort(previous);
        let port;
        let closedDuringOpen = false;
        let errorDuringOpen = null;
        const markClosedDuringOpen = () => { closedDuringOpen = true; };
        const markErrorDuringOpen = (err) => { errorDuringOpen = err; };
        try {
          port = new SP({ path, baudRate, dataBits, stopBits, parity, autoOpen: false });
          port.on('close', markClosedDuringOpen);
          port.on('error', markErrorDuringOpen);
          await new Promise((resolve, reject) => port.open((err) => (err ? reject(err) : resolve())));
        } catch (e) {
          try { if (port) { port.removeListener('close', markClosedDuringOpen); port.removeListener('error', markErrorDuringOpen); } } catch {}
          await closePort(port);
          return { ok: false, error: e.message };
        }
        if (generation !== serialGeneration || closedDuringOpen || !port.isOpen) {
          try { port.removeListener('close', markClosedDuringOpen); port.removeListener('error', markErrorDuringOpen); } catch {}
          await closePort(port);
          return { ok: false, error: generation !== serialGeneration ? '串口连接已被新的操作替换' : '串口在打开过程中已断开' };
        }
        activeSerial = port;
        // 攒批推送：Windows 驱动常把数据切成几字节一个 data 事件，高波特率下每秒数百次，
        // 逐条 IPC + Array.from 普通数组会拖垮渲染端。这里合并 30ms 窗口内的数据一次推送，
        // 直接传 Uint8Array（结构化克隆按字节拷贝，远快于 Number 数组）。
        let rxChunks = [];
        let rxSize = 0;
        let rxTimer = null;
        const isCurrent = () => serialGeneration === generation && activeSerial === port;
        const clearRx = () => {
          if (rxTimer) { clearTimeout(rxTimer); rxTimer = null; }
          rxChunks = [];
          rxSize = 0;
        };
        const flushRx = () => {
          if (rxTimer) { clearTimeout(rxTimer); rxTimer = null; }
          if (!rxChunks.length) return;
          const merged = rxChunks.length === 1 ? rxChunks[0] : Buffer.concat(rxChunks, rxSize);
          rxChunks = []; rxSize = 0;
          if (isCurrent()) pushSerial('serial-data', new Uint8Array(merged));
        };
        port.on('data', (buf) => {
          if (!isCurrent()) return;
          const chunk = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
          if (!chunk.length) return;
          // 单个驱动 chunk 也可能异常偏大，分段刷出，限制后端驻留内存。
          if (chunk.length >= MAX_SERIAL_BATCH_BYTES) {
            flushRx();
            for (let offset = 0; offset < chunk.length; offset += MAX_SERIAL_BATCH_BYTES) {
              if (!isCurrent()) break;
              pushSerial('serial-data', new Uint8Array(chunk.subarray(offset, offset + MAX_SERIAL_BATCH_BYTES)));
            }
            return;
          }
          if (rxSize + chunk.length > MAX_SERIAL_BATCH_BYTES) flushRx();
          rxChunks.push(chunk); rxSize += chunk.length;
          if (rxSize >= MAX_SERIAL_BATCH_BYTES) flushRx();
          else if (!rxTimer) rxTimer = setTimeout(flushRx, 30);
        });
        port.on('close', () => {
          if (!isCurrent()) { clearRx(); return; }
          flushRx();
          activeSerial = null;
          serialGeneration++;
          pushSerial('serial-closed');
        });
        port.on('error', (err) => {
          if (isCurrent()) pushSerial('serial-error', err && err.message ? err.message : String(err));
        });
        port.removeListener('close', markClosedDuringOpen);
        port.removeListener('error', markErrorDuringOpen);
        if (errorDuringOpen && isCurrent()) pushSerial('serial-error', errorDuringOpen.message || String(errorDuringOpen));
        return { ok: true };
      });
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('serial-write', async (_e, data) => {
    const port = activeSerial;
    const generation = serialGeneration;
    if (!port || !port.isOpen) return { ok: false, error: '串口未连接' };
    try {
      const payload = readSerialPayload(data);
      await new Promise((resolve, reject) => port.write(payload, (err) => (err ? reject(err) : resolve())));
      await new Promise((resolve) => port.drain(() => resolve()));
      if (generation !== serialGeneration || activeSerial !== port) return { ok: false, error: '串口连接已切换' };
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('serial-close', async () => {
    return await enqueueSerialOperation(async () => {
      const port = activeSerial;
      activeSerial = null;
      serialGeneration++;
      try { await closePort(port); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    });
  });
}

async function closeActiveSerial() {
  return await enqueueSerialOperation(async () => {
    const port = activeSerial;
    activeSerial = null;
    serialGeneration++;
    try { await closePort(port); } catch {}
    return { ok: true };
  });
}

module.exports = { registerSerial, closeActiveSerial };
