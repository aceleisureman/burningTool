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
