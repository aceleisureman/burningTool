const path = require('path');
const fs = require('fs');
const { runProcess, runCapture } = require('../toolchain/proc');
const bus = require('../core/bus');
// 延迟引入 toolchain：它依赖 electron，eager require 会让纯函数无法在 `node --test` 下单测
function toolchain() { return require('../toolchain/toolchain'); }

// esptool 支持的芯片（auto = 让 esptool 自动探测，省略 --chip）
const CHIPS = new Set([
  'auto', 'esp32', 'esp32s2', 'esp32s3', 'esp32c2', 'esp32c3',
  'esp32c6', 'esp32h2', 'esp32p4', 'esp8266'
]);
const FLASH_MODES = new Set(['keep', 'qio', 'qout', 'dio', 'dout']);
const FLASH_FREQS = new Set(['keep', '80m', '60m', '48m', '40m', '30m', '26m', '24m', '20m', '16m', '15m']);
const FLASH_SIZES = new Set(['keep', 'detect', '256KB', '512KB', '1MB', '2MB', '2MB-c1', '4MB', '8MB', '16MB', '32MB', '64MB', '128MB']);
const BEFORE_RESET = new Set(['default_reset', 'usb_reset', 'no_reset', 'no_reset_no_sync']);
const AFTER_RESET = new Set(['hard_reset', 'soft_reset', 'no_reset', 'no_reset_stub']);
// esptool 只能烧写裸二进制（.bin）；.hex/.elf 需先转 .bin
const FIRMWARE_EXTS = new Set(['.bin']);

function cleanPath(value) {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

function normalizeChip(value) {
  const chip = String(value || 'auto').trim().toLowerCase();
  return CHIPS.has(chip) ? chip : 'auto';
}

function normalizeBaud(value, fallback) {
  const baud = Number(value) || fallback;
  return Math.min(2000000, Math.max(9600, baud | 0));
}

function pickEnum(value, set, fallback) {
  const v = String(value || '').trim();
  return set.has(v) ? v : fallback;
}

// 解析烧录地址：接受 '0x1000' / '4096' / 4096，统一规整成小写十六进制 '0x1000'；非法返回 null
function normalizeOffset(value) {
  if (value === 0 || value === '0') return '0x0';
  const text = String(value == null ? '' : value).trim();
  if (!text) return null;
  let n;
  if (/^0x[0-9a-f]+$/i.test(text)) n = parseInt(text, 16);
  else if (/^\d+$/.test(text)) n = parseInt(text, 10);
  else return null;
  if (!Number.isFinite(n) || n < 0) return null;
  return '0x' + n.toString(16);
}

function firmwareInfo(filePath) {
  const firmwarePath = cleanPath(filePath);
  if (!firmwarePath) return { ok: false, error: '未选择固件' };
  if (!fs.existsSync(firmwarePath)) return { ok: false, error: `固件不存在: ${firmwarePath}` };
  const ext = path.extname(firmwarePath).toLowerCase();
  if (!FIRMWARE_EXTS.has(ext)) return { ok: false, error: 'esptool 仅支持 .bin 固件（.hex/.elf 请先转换为 .bin）' };
  const stat = fs.statSync(firmwarePath);
  return { ok: true, path: firmwarePath, name: path.basename(firmwarePath), ext, size: stat.size, mtime: stat.mtimeMs };
}

// 把前端传入的烧录条目整理成 [{offset, info}]：parts 优先，否则单文件 + flashOffset
function resolveFlashParts(opts) {
  const raw = Array.isArray(opts.parts) && opts.parts.length
    ? opts.parts
    : [{ offset: opts.flashOffset, path: opts.firmwarePath }];
  const parts = [];
  for (const item of raw) {
    if (!item || !cleanPath(item.path)) continue;
    const offset = normalizeOffset(item.offset == null ? '0x0' : item.offset);
    if (offset === null) return { ok: false, error: `烧录地址非法: ${item.offset}` };
    const info = firmwareInfo(item.path);
    if (!info.ok) return { ok: false, error: info.error };
    parts.push({ offset, info });
  }
  if (!parts.length) return { ok: false, error: '未选择任何固件' };
  // 地址去重，避免同一 offset 烧两份
  const seen = new Set();
  for (const p of parts) {
    if (seen.has(p.offset)) return { ok: false, error: `烧录地址重复: ${p.offset}` };
    seen.add(p.offset);
  }
  return { ok: true, parts };
}

async function probeInvocation(command, argsPrefix) {
  const version = await runCapture(command, [...argsPrefix, 'version'], { shell: false, timeoutMs: 8000 });
  const help = version.code === 0 ? version : await runCapture(command, [...argsPrefix, '--version'], { shell: false, timeoutMs: 8000 });
  const text = String(`${version.out || ''}\n${help.out || ''}`).trim();
  if (version.code === 0 || /esptool|v\d+\.\d+/i.test(text)) {
    return { ok: true, command, argsPrefix, version: text.split(/\r?\n/).find(Boolean) || 'esptool' };
  }
  return { ok: false };
}

async function resolveEsptoolInvocation(cfg = {}, opts = {}) {
  const { findExecutableOnPath, localEsptoolBin, localEsptoolPython } = toolchain();
  // 与 pyOCD/OpenOCD/stcgal 一致：优先项目根目录 toolchain/esptool 下的独立环境
  const localBin = localEsptoolBin();
  if (fs.existsSync(localBin)) {
    const r = await probeInvocation(localBin, []);
    if (r.ok) return r;
  }
  const localPython = localEsptoolPython();
  if (fs.existsSync(localPython)) {
    const r = await probeInvocation(localPython, ['-m', 'esptool']);
    if (r.ok) return r;
  }

  const configured = cleanPath(opts.esptoolPath || cfg.esptoolPath);
  const isWin = process.platform === 'win32';
  const direct = [
    configured,
    findExecutableOnPath(isWin ? 'esptool.exe' : 'esptool'),
    findExecutableOnPath('esptool.py'),
    'esptool',
    'esptool.py'
  ].filter(Boolean);
  const seen = new Set();
  for (const cmd of direct) {
    if (seen.has(cmd)) continue;
    seen.add(cmd);
    if (/[\\/]/.test(cmd) && !fs.existsSync(cmd)) continue;
    const r = await probeInvocation(cmd, []);
    if (r.ok) return r;
  }

  const pythonCandidates = isWin ? ['py', 'python'] : ['python3', 'python'];
  for (const python of pythonCandidates) {
    const r = await probeInvocation(python, ['-m', 'esptool']);
    if (r.ok) return r;
  }

  return {
    ok: false,
    error: '未找到 esptool。可点击「安装到项目环境」一键装入 toolchain/esptool（参考 pyOCD/stcgal 做法），或手动：python3 -m pip install esptool'
  };
}

async function esp32ToolStatus(cfg = {}) {
  const r = await resolveEsptoolInvocation(cfg);
  if (!r.ok) return r;
  const { localEsptoolBin, localEsptoolPython } = toolchain();
  const local = r.command === localEsptoolBin() || r.command === localEsptoolPython();
  return { ok: true, command: r.command, argsPrefix: r.argsPrefix, version: r.version, local };
}

function displayCommand(command, args) {
  return [command, ...args].map((part) => /\s/.test(String(part)) ? `"${String(part).replace(/"/g, '\\"')}"` : String(part)).join(' ');
}

function buildGlobalArgs(opts, port) {
  const args = [];
  const chip = normalizeChip(opts.chip);
  if (chip !== 'auto') args.push('--chip', chip);
  if (port) args.push('--port', port);
  args.push('--baud', String(normalizeBaud(opts.baudRate, 460800)));
  args.push('--before', pickEnum(opts.beforeReset, BEFORE_RESET, 'default_reset'));
  args.push('--after', pickEnum(opts.afterReset, AFTER_RESET, 'hard_reset'));
  return args;
}

async function flashEsp32(opts = {}, cfg = {}) {
  const port = cleanPath(opts.portPath);
  if (!port) { bus.send('[ESP32] ✗ 未选择串口', 'error'); return { ok: false, error: '未选择串口' }; }

  const eraseOnly = opts.eraseOnly === true;
  const readMacOnly = opts.readMacOnly === true;

  let parts = null;
  if (!eraseOnly && !readMacOnly) {
    const resolved = resolveFlashParts(opts);
    if (!resolved.ok) { bus.send(`[ESP32] ✗ ${resolved.error}`, 'error'); return { ok: false, error: resolved.error }; }
    parts = resolved.parts;
  }

  const tool = await resolveEsptoolInvocation(cfg, opts);
  if (!tool.ok) { bus.send(`[ESP32] ✗ ${tool.error}`, 'error'); return { ok: false, error: tool.error }; }

  const chip = normalizeChip(opts.chip);
  const args = [...tool.argsPrefix, ...buildGlobalArgs(opts, port)];

  let mode;
  if (readMacOnly) {
    mode = 'read_mac';
    args.push('read_mac');
  } else if (eraseOnly) {
    mode = 'erase_flash';
    args.push('erase_flash');
  } else {
    mode = 'write_flash';
    args.push('write_flash');
    args.push('--flash_mode', pickEnum(opts.flashMode, FLASH_MODES, 'keep'));
    args.push('--flash_freq', pickEnum(opts.flashFreq, FLASH_FREQS, 'keep'));
    args.push('--flash_size', pickEnum(opts.flashSize, FLASH_SIZES, 'detect'));
    if (opts.eraseBeforeWrite === true) args.push('--erase-all');
    if (opts.noStub === true) args.push('--no-stub');
    for (const p of parts) args.push(p.offset, p.info.path);
  }

  bus.send('═════════ ESP32 烧录 ═════════', 'step');
  bus.send(`[ESP32] 芯片: ${chip === 'auto' ? '自动探测' : chip} · 串口: ${port} · 波特率 ${normalizeBaud(opts.baudRate, 460800)}`, 'info');
  if (mode === 'read_mac') {
    bus.send('[ESP32] 模式: 读取 MAC 地址', 'info');
  } else if (mode === 'erase_flash') {
    bus.send('[ESP32] 模式: 全片擦除 Flash', 'info');
  } else {
    bus.send(`[ESP32] 模式: write_flash · ${pickEnum(opts.flashMode, FLASH_MODES, 'keep')}/${pickEnum(opts.flashFreq, FLASH_FREQS, 'keep')}/${pickEnum(opts.flashSize, FLASH_SIZES, 'detect')}`, 'info');
    for (const p of parts) bus.send(`[ESP32] ${p.offset}  ${p.info.path} (${p.info.size} bytes)`, 'info');
  }
  bus.send(`[ESP32] 复位: before=${pickEnum(opts.beforeReset, BEFORE_RESET, 'default_reset')} after=${pickEnum(opts.afterReset, AFTER_RESET, 'hard_reset')}`, 'info');
  bus.send(`[ESP32] 命令: ${displayCommand(tool.command, args)}`, 'step');

  const code = await runProcess(tool.command, args, { shell: false });
  const ok = code === 0;
  bus.send(ok ? '[ESP32] ✓ 操作完成' : `[ESP32] ✗ 操作失败 (exit ${code})`, ok ? 'success' : 'error');
  return { ok, code, mode, chip, port, parts: parts ? parts.map((p) => ({ offset: p.offset, path: p.info.path, size: p.info.size })) : [] };
}

module.exports = {
  CHIPS, FLASH_MODES, FLASH_FREQS, FLASH_SIZES, BEFORE_RESET, AFTER_RESET,
  normalizeChip, normalizeBaud, normalizeOffset, resolveFlashParts, buildGlobalArgs,
  firmwareInfo, esp32ToolStatus, flashEsp32
};
