const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');
const bus = require('../core/bus');
const { runCapture } = require('../toolchain/proc');
const { resolvePyocdPath } = require('../toolchain/toolchain');
const { normalizePyocdTarget } = require('../flash/stm32-targets');
const { diagnosePyocdOutput } = require('../flash/pyocd-diagnostics');

const DEFAULT_RAM_LOG_CONFIG = {
  base: '0x20004800',
  magic: '0x524C4F47',
  size: 1024,
  interval: 500,
  encoding: 'utf-8',
  ring: true,
  offsets: {
    magic: 0,
    version: 4,
    size: 8,
    writePos: 12,
    seq: 16,
    data: 20
  }
};

function parseNumber(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const s = String(value == null ? '' : value).trim();
  if (/^0x[0-9a-f]+$/i.test(s)) return Number.parseInt(s, 16);
  if (/^[0-9]+$/.test(s)) return Number.parseInt(s, 10);
  if (/^[0-9a-f]+$/i.test(s)) return Number.parseInt(s, 16);
  return fallback;
}

function hex32(n) {
  return `0x${(Number(n) >>> 0).toString(16).padStart(8, '0')}`;
}

function normalizeRamLogConfig(input = {}) {
  const src = Object.assign({}, DEFAULT_RAM_LOG_CONFIG, input || {});
  const offsets = Object.assign({}, DEFAULT_RAM_LOG_CONFIG.offsets, src.offsets || {});
  const size = Math.min(16384, Math.max(16, parseNumber(src.size, DEFAULT_RAM_LOG_CONFIG.size)));
  return {
    base: hex32(parseNumber(src.base, parseNumber(DEFAULT_RAM_LOG_CONFIG.base))),
    magic: hex32(parseNumber(src.magic, parseNumber(DEFAULT_RAM_LOG_CONFIG.magic))),
    size,
    interval: Math.min(10000, Math.max(200, parseNumber(src.interval, DEFAULT_RAM_LOG_CONFIG.interval))),
    encoding: src.encoding || DEFAULT_RAM_LOG_CONFIG.encoding,
    ring: src.ring !== false,
    offsets: {
      magic: Math.max(0, parseNumber(offsets.magic, 0)),
      version: Math.max(0, parseNumber(offsets.version, 4)),
      size: Math.max(0, parseNumber(offsets.size, 8)),
      writePos: Math.max(0, parseNumber(offsets.writePos, 12)),
      seq: Math.max(0, parseNumber(offsets.seq, 16)),
      data: Math.max(4, parseNumber(offsets.data, 20))
    }
  };
}

function parseRead32Words(out) {
  const words = [];
  for (const line of String(out || '').split(/\r?\n/)) {
    const head = line.match(/^\s*(?:0x)?[0-9a-fA-F]+\s*:\s*(.*?)(?:\s+\|.*)?$/);
    if (!head) continue;
    const body = head[1];
    const dataTokens = body.match(/(?:0x)?[0-9a-fA-F]{1,8}/g) || [];
    for (const t of dataTokens) words.push(Number.parseInt(t, 16) >>> 0);
  }
  return words;
}

function wordsToBytesLE(words, byteLength) {
  const bytes = new Uint8Array(byteLength);
  let i = 0;
  for (const word of words || []) {
    if (i < byteLength) bytes[i++] = word & 0xff;
    if (i < byteLength) bytes[i++] = (word >>> 8) & 0xff;
    if (i < byteLength) bytes[i++] = (word >>> 16) & 0xff;
    if (i < byteLength) bytes[i++] = (word >>> 24) & 0xff;
  }
  return bytes;
}

function readU32(bytes, offset) {
  if (!bytes || offset + 4 > bytes.length) return 0;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function trimLogBytes(bytes) {
  let start = 0;
  let end = bytes.length;
  while (start < end && bytes[start] === 0) start++;
  while (end > start && bytes[end - 1] === 0) end--;
  return bytes.slice(start, end);
}

function decodeBytes(bytes, encoding) {
  try {
    return new TextDecoder(encoding || 'utf-8', { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

function summarizePyocdFailure(out, fallback) {
  const items = diagnosePyocdOutput(out);
  if (items.length) return `${items[0].reason}：${items[0].suggestion}`;
  const tail = String(out || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-2).join(' / ');
  return tail ? `${fallback}：${tail}` : fallback;
}

function decodeRamLogSnapshot(bytes, cfgInput = {}) {
  const cfg = normalizeRamLogConfig(cfgInput);
  const magic = readU32(bytes, cfg.offsets.magic);
  const sizeFromHeader = readU32(bytes, cfg.offsets.size);
  const bufferSize = Math.min(cfg.size, sizeFromHeader || cfg.size, Math.max(0, bytes.length - cfg.offsets.data));
  const writePosRaw = readU32(bytes, cfg.offsets.writePos);
  const writePos = bufferSize ? Math.min(bufferSize, writePosRaw % (bufferSize + 1)) : 0;
  const meta = {
    magic,
    magicHex: hex32(magic),
    expectedMagicHex: cfg.magic,
    magicOk: magic === parseNumber(cfg.magic),
    version: readU32(bytes, cfg.offsets.version),
    size: bufferSize,
    writePos,
    seq: readU32(bytes, cfg.offsets.seq)
  };
  const data = bytes.slice(cfg.offsets.data, cfg.offsets.data + bufferSize);
  let ordered;
  if (cfg.ring && bufferSize > 0) {
    ordered = new Uint8Array(bufferSize);
    ordered.set(data.slice(writePos), 0);
    ordered.set(data.slice(0, writePos), bufferSize - writePos);
  } else {
    ordered = data.slice(0, Math.min(writePos, bufferSize));
  }
  const cleanBytes = trimLogBytes(ordered);
  return {
    ok: meta.magicOk,
    meta,
    text: decodeBytes(cleanBytes, cfg.encoding),
    rawHex: Array.from(cleanBytes).map((b) => b.toString(16).padStart(2, '0')).join(' ')
  };
}

function read32ByteLength(cfgInput = {}) {
  const cfg = normalizeRamLogConfig(cfgInput);
  return Math.ceil((cfg.offsets.data + cfg.size) / 4) * 4;
}

let activeRead = null;

async function readRamLog(opts = {}, appConfig = {}) {
  if (activeRead) {
    return {
      ok: false,
      busy: true,
      error: 'RAM Log 正在读取中，请等待本次读取结束后再试'
    };
  }
  activeRead = doReadRamLog(opts, appConfig);
  try {
    return await activeRead;
  } finally {
    activeRead = null;
  }
}

async function doReadRamLog(opts = {}, appConfig = {}) {
  const ramCfg = normalizeRamLogConfig(Object.assign({}, appConfig.ramLogConfig || {}, opts || {}));
  const resolved = resolvePyocdPath(appConfig);
  const pyocd = resolved.pyocd;
  if (!pyocd || (pyocd.includes(path.sep) && !fs.existsSync(pyocd))) {
    return { ok: false, error: `pyOCD 不存在: ${pyocd || '未配置'}`, pyocd, config: ramCfg };
  }
  const target = normalizePyocdTarget(appConfig.targetChip || 'stm32f103c8');
  const totalBytes = ramCfg.offsets.data + ramCfg.size;
  const readBytes = read32ByteLength(ramCfg);
  const resetArg = appConfig.connectUnderReset ? ['-O', 'connect_mode=under-reset'] : [];
  const command = `read32 ${ramCfg.base} ${readBytes}`;
  // quiet：渲染端轮询模式传入，避免 2~5Hz 的固定环境日志刷屏烧录日志面板
  if (!opts.quiet) {
    bus.send(`[内存日志] 系统: ${process.platform}/${process.arch}`, 'info');
    bus.send(`[内存日志] pyOCD: ${pyocd}`, 'info');
    bus.send(`[内存日志] 读取地址: ${ramCfg.base}，长度: ${totalBytes} bytes`, 'info');
  }
  const { code, out, timedOut } = await runCapture(pyocd, ['cmd', '-t', target, ...resetArg, '-c', command], {
    shell: false,
    timeoutMs: 12000
  });
  if (timedOut) return { ok: false, error: summarizePyocdFailure(out, '读取 RAM 日志超时'), code, out, pyocd, target, config: ramCfg };
  if (code !== 0) return { ok: false, error: summarizePyocdFailure(out, `pyOCD read32 失败 (exit ${code})`), code, out, pyocd, target, config: ramCfg };
  const words = parseRead32Words(out);
  if (words.length === 0) {
    return { ok: false, error: summarizePyocdFailure(out, '未读取到 RAM 数据'), code, out, pyocd, target, config: ramCfg, words: 0 };
  }
  const bytes = wordsToBytesLE(words, totalBytes);
  return Object.assign(decodeRamLogSnapshot(bytes, ramCfg), {
    code,
    out,
    pyocd,
    target,
    config: ramCfg,
    words: words.length
  });
}

module.exports = {
  DEFAULT_RAM_LOG_CONFIG,
  normalizeRamLogConfig,
  parseRead32Words,
  wordsToBytesLE,
  read32ByteLength,
  decodeRamLogSnapshot,
  readRamLog
};
