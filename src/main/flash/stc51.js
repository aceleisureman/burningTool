const path = require('path');
const fs = require('fs');
const { runProcess, runCapture } = require('../toolchain/proc');
const { findExecutableOnPath, localStcgalBin, localStcgalPython } = require('../toolchain/toolchain');
const bus = require('../core/bus');

const PROTOCOLS = new Set(['auto', 'stc89', 'stc89a', 'stc12a', 'stc12b', 'stc12', 'stc15a', 'stc15', 'stc8', 'stc8d', 'stc8g', 'usb15']);
const RESET_PINS = new Set(['dtr', 'rts', 'dtr_inverted', 'rts_inverted']);
const FIRMWARE_EXTS = new Set(['.hex', '.ihx', '.ihex', '.bin']);

function cleanPath(value) {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

function normalizeProtocol(value) {
  const protocol = String(value || 'auto').trim().toLowerCase();
  return PROTOCOLS.has(protocol) ? protocol : 'auto';
}

function normalizeBaud(value, fallback) {
  const baud = Number(value) || fallback;
  return Math.min(921600, Math.max(1200, baud | 0));
}

function normalizeResetPin(value) {
  const pin = String(value || 'dtr').trim().toLowerCase();
  return RESET_PINS.has(pin) ? pin : 'dtr';
}

function normalizeOptions(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter((item) => /^[a-z0-9_]+=[^=]+$/i.test(item));
  return String(value || '').split(/\r?\n|,/).map((item) => item.trim()).filter((item) => /^[a-z0-9_]+=[^=]+$/i.test(item));
}

function normalizeTrim(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const khz = Number(text);
  if (!Number.isFinite(khz) || khz <= 0) return '';
  return String(khz | 0);
}

function firmwareInfo(filePath, required = true) {
  const firmwarePath = cleanPath(filePath);
  if (!firmwarePath) return required ? { ok: false, error: '未选择固件' } : { ok: true, path: '', name: '', ext: '', size: 0 };
  if (!fs.existsSync(firmwarePath)) return { ok: false, error: `固件不存在: ${firmwarePath}` };
  const ext = path.extname(firmwarePath).toLowerCase();
  if (!FIRMWARE_EXTS.has(ext)) return { ok: false, error: '仅支持 .hex / .ihx / .ihex / .bin 固件' };
  const stat = fs.statSync(firmwarePath);
  return {
    ok: true,
    path: firmwarePath,
    name: path.basename(firmwarePath),
    ext,
    size: stat.size,
    mtime: stat.mtimeMs
  };
}

async function probeInvocation(command, argsPrefix) {
  try {
    const version = await runCapture(command, [...argsPrefix, '--version'], { shell: false, timeoutMs: 8000 });
    const help = version.code === 0 ? version : await runCapture(command, [...argsPrefix, '-h'], { shell: false, timeoutMs: 8000 });
    const text = String(`${version.out || ''}\n${help.out || ''}`).trim();
    if (version.code === 0 || /stcgal/i.test(text)) return { ok: true, command, argsPrefix, version: text.split(/\r?\n/).find(Boolean) || 'stcgal' };
    return { ok: false };
  } catch (err) {
    return { ok: false };
  }
}

// 探测结果缓存：同 esp32.js —— 避免每次面板状态查询/烧录都重复串行 spawn 候选进程。
// 只缓存成功结果；command 为具体路径时校验仍存在，失效自动重探。
let _stcgalCache = null;   // { key, result }

async function resolveStcgalInvocation(cfg = {}, opts = {}) {
  const key = cleanPath(opts.stcgalPath || cfg.stcgalPath) || '';
  if (_stcgalCache && _stcgalCache.key === key) {
    const c = _stcgalCache.result;
    if (!/[\\/]/.test(c.command) || fs.existsSync(c.command)) return c;
    _stcgalCache = null;
  }
  const r = await resolveStcgalInvocationUncached(cfg, opts);
  if (r.ok) _stcgalCache = { key, result: r };
  return r;
}

async function resolveStcgalInvocationUncached(cfg = {}, opts = {}) {
  // 与烧录工具的 pyOCD/OpenOCD 一致：永远优先使用项目根目录 toolchain/stcgal 下的环境
  const localBin = localStcgalBin();
  if (fs.existsSync(localBin)) {
    const r = await probeInvocation(localBin, []);
    if (r.ok) return r;
  }
  const localPython = localStcgalPython();
  if (fs.existsSync(localPython)) {
    const r = await probeInvocation(localPython, ['-m', 'stcgal']);
    if (r.ok) return r;
  }

  const configured = cleanPath(opts.stcgalPath || cfg.stcgalPath);
  const exe = process.platform === 'win32' ? 'stcgal.exe' : 'stcgal';
  const direct = [configured, findExecutableOnPath(exe), findExecutableOnPath('stcgal'), 'stcgal'].filter(Boolean);
  const seen = new Set();

  for (const cmd of direct) {
    if (seen.has(cmd)) continue;
    seen.add(cmd);
    if (cmd.includes(path.sep) && !fs.existsSync(cmd)) continue;
    const r = await probeInvocation(cmd, []);
    if (r.ok) return r;
  }

  const pythonCandidates = process.platform === 'win32' ? ['py', 'python'] : ['python3', 'python'];
  for (const python of pythonCandidates) {
    const r = await probeInvocation(python, ['-m', 'stcgal']);
    if (r.ok) return r;
  }

  return {
    ok: false,
    error: '未找到 stcgal。可点击「安装到项目环境」一键装入 toolchain/stcgal（参考烧录工具的 pyOCD/OpenOCD 做法），或手动：python3 -m pip install stcgal'
  };
}

async function stc51ToolStatus(cfg = {}) {
  const r = await resolveStcgalInvocation(cfg);
  if (!r.ok) return r;
  const local = r.command === localStcgalBin() || r.command === localStcgalPython();
  return { ok: true, command: r.command, argsPrefix: r.argsPrefix, version: r.version, local };
}

function displayCommand(command, args) {
  return [command, ...args].map((part) => /\s/.test(String(part)) ? `"${String(part).replace(/"/g, '\\"')}"` : String(part)).join(' ');
}

async function flashStc51(opts = {}, cfg = {}) {
  const eraseOnly = opts.eraseOnly === true;
  const info = firmwareInfo(opts.firmwarePath, !eraseOnly);
  if (!info.ok) { bus.send(`[StcGal] ✗ ${info.error}`, 'error'); return { ok: false, error: info.error }; }
  const eepromInfo = firmwareInfo(opts.eepromPath, false);
  if (!eepromInfo.ok) { bus.send(`[StcGal] ✗ ${eepromInfo.error}`, 'error'); return { ok: false, error: eepromInfo.error }; }

  const port = cleanPath(opts.portPath);
  const protocol = normalizeProtocol(opts.protocol);
  if (!port && protocol !== 'usb15') { bus.send('[StcGal] ✗ 未选择串口', 'error'); return { ok: false, error: '未选择串口' }; }

  const tool = await resolveStcgalInvocation(cfg, opts);
  if (!tool.ok) { bus.send(`[StcGal] ✗ ${tool.error}`, 'error'); return { ok: false, error: tool.error }; }

  const baud = normalizeBaud(opts.baudRate, 115200);
  const handshakeBaud = normalizeBaud(opts.handshakeBaud, 2400);
  const args = [...tool.argsPrefix];
  if (eraseOnly) args.push('-e');
  const resetCmd = String(opts.resetCmd || '').trim();
  const useAutoReset = opts.autoReset === true || !!resetCmd;
  if (useAutoReset) args.push('-a', '-A', normalizeResetPin(opts.resetPin));
  if (resetCmd) args.push('-r', resetCmd);
  if (protocol !== 'auto') args.push('-P', protocol);
  if (port) args.push('-p', port);
  if (protocol !== 'usb15') args.push('-b', String(baud), '-l', String(handshakeBaud));
  const trim = normalizeTrim(opts.trimKHz);
  if (trim) args.push('-t', trim);
  const options = normalizeOptions(opts.optionsText || opts.options);
  for (const option of options) args.push('-o', option);
  if (opts.debug) args.push('-D');
  if (info.path) args.push(info.path);
  if (eepromInfo.path) args.push(eepromInfo.path);

  bus.send('═════════ StcGal 烧录 ═════════', 'step');
  if (eraseOnly) bus.send('[StcGal] 模式: 仅擦除 Flash', 'info');
  if (info.path) bus.send(`[StcGal] 代码镜像: ${info.path} (${info.size} bytes)`, 'info');
  if (eepromInfo.path) bus.send(`[StcGal] EEPROM/IAP 镜像: ${eepromInfo.path} (${eepromInfo.size} bytes)`, 'info');
  bus.send(protocol === 'usb15' ? '[StcGal] USB BSL 模式：串口和波特率参数会被 stcgal 忽略' : `[StcGal] 串口: ${port} · 下载波特率 ${baud} · 握手波特率 ${handshakeBaud}`, 'info');
  bus.send(`[StcGal] 协议: ${protocol === 'auto' ? '自动识别' : protocol}`, 'info');
  if (useAutoReset) bus.send(`[StcGal] 自动复位: ${normalizeResetPin(opts.resetPin)}${resetCmd ? ` · 命令 ${resetCmd}` : ''}`, 'info');
  if (trim) bus.send(`[StcGal] RC Trim: ${trim} kHz`, 'info');
  if (options.length) bus.send(`[StcGal] Options: ${options.join(', ')}`, 'info');
  if (!useAutoReset) bus.send('[StcGal] 操作提示：先让单片机断电，点击下载后在 stcgal 等待握手时再上电或按复位。', 'info');
  bus.send(`[StcGal] 命令: ${displayCommand(tool.command, args)}`, 'step');

  const code = await runProcess(tool.command, args, { shell: false });
  const ok = code === 0;
  bus.send(ok ? '[StcGal] ✓ 操作完成' : `[StcGal] ✗ 操作失败 (exit ${code})`, ok ? 'success' : 'error');
  return { ok, code, firmware: info.path, eeprom: eepromInfo.path, port, protocol, baudRate: baud, handshakeBaud, eraseOnly };
}

module.exports = { firmwareInfo, stc51ToolStatus, flashStc51 };
