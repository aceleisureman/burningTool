/*
 * 渲染层纯函数工具集（无 DOM / Vue / IPC 依赖）。
 * ESM：供 App.vue 经 import 使用；Node 单测见 ../util.js（UMD 版，逻辑一致）。
 */

// 路径末段（去掉结尾斜杠，兼容 \ 与 /）
export function baseName(p) {
  const s = String(p).replace(/[\\/]+$/, '');
  const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
  return i >= 0 ? s.slice(i + 1) : s;
}

export function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// JSON 语法高亮：key / 字符串 / 数字 / 布尔 / null 分色
export function highlightJson(text) {
  return escHtml(text).replace(
    /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"\s*:?|\b(?:true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)/g,
    (m) => {
      let cls = 'jt-num';
      if (/^"/.test(m)) cls = /:\s*$/.test(m) ? 'jt-key' : 'jt-str';
      else if (m === 'true' || m === 'false') cls = 'jt-bool';
      else if (m === 'null') cls = 'jt-null';
      return '<span class="' + cls + '">' + m + '</span>';
    }
  );
}

// 自动格式化 JSON payload（非 HEX 且能解析时缩进美化）
export function fmtPayload(text, isHex) {
  if (isHex) return { text: text || '', json: false };
  const t = (text || '').trim();
  if ((t[0] === '{' && t[t.length - 1] === '}') || (t[0] === '[' && t[t.length - 1] === ']')) {
    try { return { text: JSON.stringify(JSON.parse(t), null, 2), json: true }; } catch (e) { /* 非合法 JSON，原样返回 */ }
  }
  return { text: text || '', json: false };
}

// MQTT 主题通配匹配（# 多级，+ 单级）
export function topicMatch(filter, topic) {
  const f = String(filter).split('/'), t = String(topic).split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (f[i] === '+') { if (t[i] === undefined) return false; continue; }
    if (f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

// 常见 USB 转串口/调试器芯片识别（按 VID，serialport 给的是十六进制字符串）
const USB_VENDORS = {
  '1a86': 'CH340/CH9102（沁恒）', '10c4': 'CP210x（SiLabs）', '0403': 'FTDI',
  '0483': 'ST-Link / STM32（ST）', '067b': 'PL2303（Prolific）', '2341': 'Arduino',
  '1366': 'J-Link（SEGGER）', 'c251': 'CMSIS-DAP / PWLink'
};
export function vidName(vidHex) {
  if (!vidHex) return '';
  const k = String(vidHex).toLowerCase().padStart(4, '0');
  return USB_VENDORS[k] || ('VID 0x' + k.toUpperCase());
}

// 端口显示名（COMx）与副标题（友好名 · 芯片 · VID/PID）
export function portMainLabel(p) { return p.path || '未知串口'; }
export function portSubLabel(p) {
  const parts = [];
  const fn = (p.friendlyName || '').replace(/\s*\(COM\d+\)\s*/i, '').trim();
  if (fn) parts.push(fn);
  else if (p.manufacturer) parts.push(p.manufacturer);
  const chip = vidName(p.vendorId);
  if (chip && !parts.some((s) => s.includes(chip.split('（')[0]))) parts.push(chip);
  if (p.vendorId || p.productId) parts.push('VID:' + (p.vendorId || '----').toUpperCase() + ' PID:' + (p.productId || '----').toUpperCase());
  return parts.join(' · ');
}

const UNIT_MS = { ms: 1, s: 1000, min: 60000 };
export function cmdDelayMs(q) { return (Number(q.interval) || 0) * (UNIT_MS[q.unit] || 1); }

export function bytesToHex(u8) {
  return Array.from(u8).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}
export function hexToBytes(str) {
  const clean = String(str).replace(/0x/gi, '').replace(/[^0-9a-fA-F]/g, '');
  if (clean.length % 2 !== 0) throw new Error('HEX 长度需为偶数');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

export async function copyText(text) {
  const value = String(text ?? '');
  if (window.api && window.api.copyToClipboard) {
    await window.api.copyToClipboard(value);
    return;
  }
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = value;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
  document.body.appendChild(ta);
  ta.select();
  try {
    if (!document.execCommand('copy')) throw new Error('fallback copy failed');
  } finally {
    document.body.removeChild(ta);
  }
}

// 按取模方式 / 位序把点阵打包成字节数组
export function bytesFromGrid(grid, size, scan, msb, negative) {
  const W = size, H = size, out = [];
  const bit = (r, c) => {
    const on = (r >= 0 && r < H && c >= 0 && c < W) ? grid[r][c] : false;
    return (negative ? on : !on) ? 1 : 0;
  };
  const pack = (arr) => { let b = 0; for (let i = 0; i < 8; i++) { if (arr[i]) b |= msb ? (1 << (7 - i)) : (1 << i); } return b; };
  const colVert = (c, rb) => { const a = []; for (let k = 0; k < 8; k++) a.push(bit(rb * 8 + k, c)); return pack(a); };
  const rowHoriz = (r, cb) => { const a = []; for (let k = 0; k < 8; k++) a.push(bit(r, cb * 8 + k)); return pack(a); };
  const rowBands = Math.ceil(H / 8), colBands = Math.ceil(W / 8);
  if (scan === 'col') { for (let c = 0; c < W; c++) for (let rb = 0; rb < rowBands; rb++) out.push(colVert(c, rb)); }
  else if (scan === 'colrow') { for (let rb = 0; rb < rowBands; rb++) for (let c = 0; c < W; c++) out.push(colVert(c, rb)); }
  else if (scan === 'row') { for (let r = 0; r < H; r++) for (let cb = 0; cb < colBands; cb++) out.push(rowHoriz(r, cb)); }
  else { for (let cb = 0; cb < colBands; cb++) for (let r = 0; r < H; r++) out.push(rowHoriz(r, cb)); }
  return out;
}
export function fmtByte(b, radix) { return radix === 'hex' ? '0x' + b.toString(16).toUpperCase().padStart(2, '0') : b.toString(); }

// 当前时间 HH:MM:SS（日志/终端/消息时间戳）
export function now() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}



/* ── CRC / 校验工具 ─────────────────────────────────────────────── */
function ensureBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return hexToBytes(String(input || ''));
}

function reflectBits(value, width) {
  let x = value >>> 0;
  let y = 0;
  for (let i = 0; i < width; i++) {
    y = (y << 1) | (x & 1);
    x >>>= 1;
  }
  return y >>> 0;
}

function makeTable(width, poly, refin) {
  const mask = width === 32 ? 0xFFFFFFFF : ((1 << width) - 1);
  const top = width === 32 ? 0x80000000 : (1 << (width - 1));
  const tablePoly = refin ? reflectBits(poly, width) : (poly >>> 0);
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = refin ? i : ((i << (width - 8)) >>> 0);
    for (let k = 0; k < 8; k++) {
      if (refin) {
        c = (c & 1) ? ((c >>> 1) ^ tablePoly) : (c >>> 1);
      } else {
        c = (c & top) ? ((((c << 1) >>> 0) ^ tablePoly) >>> 0) : ((c << 1) >>> 0);
      }
      c &= mask;
    }
    table[i] = c >>> 0;
  }
  return table;
}

const CRC_ALGO_DEFS = {
  checksum8: { label: 'Checksum-8', width: 8, kind: 'sum' },
  xor8: { label: 'XOR-8', width: 8, kind: 'xor' },
  crc8: { label: 'CRC-8', width: 8, poly: 0x07, init: 0x00, refin: false, refout: false, xorout: 0x00 },
  crc8_maxim: { label: 'CRC-8/MAXIM', width: 8, poly: 0x31, init: 0x00, refin: true, refout: true, xorout: 0x00 },
  crc16_modbus: { label: 'CRC-16/MODBUS', width: 16, poly: 0x8005, init: 0xFFFF, refin: true, refout: true, xorout: 0x0000 },
  crc16_ccitt: { label: 'CRC-16/CCITT-FALSE', width: 16, poly: 0x1021, init: 0xFFFF, refin: false, refout: false, xorout: 0x0000 },
  crc16_xmodem: { label: 'CRC-16/XMODEM', width: 16, poly: 0x1021, init: 0x0000, refin: false, refout: false, xorout: 0x0000 },
  crc16_ibm: { label: 'CRC-16/IBM', width: 16, poly: 0x8005, init: 0x0000, refin: true, refout: true, xorout: 0x0000 },
  crc32: { label: 'CRC-32', width: 32, poly: 0x04C11DB7, init: 0xFFFFFFFF, refin: true, refout: true, xorout: 0xFFFFFFFF },
  crc32c: { label: 'CRC-32C', width: 32, poly: 0x1EDC6F41, init: 0xFFFFFFFF, refin: true, refout: true, xorout: 0xFFFFFFFF },
};

const CRC_TABLE_CACHE = new Map();

function getCrcTable(algo) {
  const key = `${algo.width}:${algo.poly}:${algo.refin ? 1 : 0}`;
  if (!CRC_TABLE_CACHE.has(key)) CRC_TABLE_CACHE.set(key, makeTable(algo.width, algo.poly, !!algo.refin));
  return CRC_TABLE_CACHE.get(key);
}

export function listCrcAlgorithms() {
  return Object.entries(CRC_ALGO_DEFS).map(([id, def]) => ({
    id,
    label: def.label,
    width: def.width,
    kind: def.kind || 'crc',
  }));
}

export function calcCrc(algoId, input, options = {}) {
  const algo = CRC_ALGO_DEFS[algoId];
  if (!algo) throw new Error('未知校验算法: ' + algoId);
  const bytes = ensureBytes(input);
  const mask = algo.width === 32 ? 0xFFFFFFFF : ((1 << algo.width) - 1);
  let value = 0;

  if (algo.kind === 'sum') {
    for (const b of bytes) value = (value + b) & 0xFF;
  } else if (algo.kind === 'xor') {
    for (const b of bytes) value ^= b;
    value &= 0xFF;
  } else {
    const table = getCrcTable(algo);
    value = (algo.init >>> 0) & mask;
    if (algo.refin) {
      for (const b of bytes) value = (table[(value ^ b) & 0xFF] ^ (value >>> 8)) & mask;
    } else {
      const shift = algo.width - 8;
      for (const b of bytes) {
        value = (table[((value >>> shift) ^ b) & 0xFF] ^ ((value << 8) & mask)) & mask;
      }
    }
    if (!!algo.refout !== !!algo.refin) value = reflectBits(value, algo.width) & mask;
    value = ((value ^ (algo.xorout >>> 0)) & mask) >>> 0;
  }

  if (options.invert) value = (~value) & mask;
  value = value >>> 0;
  const width = algo.width;
  const hex = value.toString(16).toUpperCase().padStart(width / 4, '0');

  // 反射算法（如 Modbus）通常按小端附加；非反射算法按大端附加
  const littleEndian = !!(algo.refin || algo.refout);
  const bytesOut = [];
  for (let i = 0; i < width; i += 8) {
    const shift = littleEndian ? i : (width - 8 - i);
    bytesOut.push((value >>> shift) & 0xFF);
  }

  return {
    algo: algoId,
    label: algo.label,
    width,
    value,
    hex,
    hexPrefixed: '0x' + hex,
    littleEndian,
    bytes: bytesOut,
    bytesHex: bytesOut.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' '),
    length: bytes.length,
  };
}

export function parseCrcInput(text, mode = 'hex') {
  const raw = String(text ?? '');
  if (!raw.trim()) return new Uint8Array();
  if (mode === 'ascii') {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(raw);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i) & 0xFF;
    return out;
  }
  if (mode === 'dec') {
    const parts = raw.trim().split(/[\s,;]+/).filter(Boolean);
    const out = new Uint8Array(parts.length);
    for (let i = 0; i < parts.length; i++) {
      const n = Number(parts[i]);
      if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error('十进制输入需为 0~255 的整数');
      out[i] = n;
    }
    return out;
  }
  return hexToBytes(raw);
}
