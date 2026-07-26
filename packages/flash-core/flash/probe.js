// CMSIS-DAP/pyOCD/OpenOCD 探针、芯片识别和硬件调试命令。
const path = require('path');
const fs = require('fs');
const bus = require('../core/bus');
const { runProcess, runCapture } = require('../toolchain/proc');
const { DEVID_MAP, chooseProbe, cleanPyocd, parseStm32DevidFromValues } = require('./flash-parsing');
const { normalizePyocdTarget, isStm32Target, openocdTargetConfig } = require('./stm32-targets');
const { loadConfig } = require('../core/env');
const { resolvePyocdPath, resolveOpenocdPath } = require('../toolchain/toolchain');

const PYOCD_FLASH_TIMEOUT_MS = 45000;

async function pyocdHasTarget(pyocd, target) {
  const { out } = await runCapture(pyocd, ['list', '--targets'], { shell: false, timeoutMs: 20000 });
  // target 经 normalizePyocdTarget 只含 [a-z0-9]，无正则特殊字符；按独立 token 匹配，容忍不同版本表格缩进/列布局
  return new RegExp(`(?:^|\\s)${target}(?:\\s|$)`, 'im').test(out);
}

const _pyocdTargetOk = new Set();

async function ensurePyocdTarget(pyocd, target) {
  if (!target) return true;
  const cacheKey = `${pyocd}::${target}`;
  if (_pyocdTargetOk.has(cacheKey)) return true;
  if (await pyocdHasTarget(pyocd, target)) { _pyocdTargetOk.add(cacheKey); return true; }
  if (isStm32Target(target)) {
    bus.send(`[烧录] pyOCD 缺少目标 ${target}，正在安装 STM32 官方 Pack ...`, 'info');
    const code = await runProcess(pyocd, ['pack', 'install', target.toUpperCase()], { shell: false });
    if (code === 0 && await pyocdHasTarget(pyocd, target)) {
      _pyocdTargetOk.add(cacheKey);
      bus.send(`[烧录] ✓ STM32 Pack 已就绪，使用目标: ${target}`, 'success');
      return true;
    }
  }
  bus.send(`[烧录] ✗ pyOCD 不支持目标: ${target}`, 'error');
  bus.send(`[烧录] 可手动执行: ${pyocd} pack install ${target.toUpperCase()}`, 'info');
  return false;
}

async function listProbes(cfg) {
  const { out, timedOut } = await runCapture(cfg.pyocdPath, ['list'], { shell: false, timeoutMs: 12000 });
  if (timedOut) return { probes: [], timedOut: true, out };
  const probes = [];
  for (const line of String(out).split(/\r?\n/)) {
    // 行形如："  0   Arm DAPLink CMSIS-DAP   4559CBD2...   n/a"（名称含空格，UID/Target 用多空格分隔）
    const m = line.match(/^\s*(\d+)\s+(.+?)\s{2,}(\S+)\s+\S+\s*$/);
    if (m) probes.push({ index: Number(m[1]), name: m[2].trim(), uid: m[3].trim() });
  }
  return { probes, out };
}

async function pickProbeUid(cfg) {
  const { probes, timedOut } = await listProbes(cfg);
  if (timedOut) { bus.send('[烧录] ⚠ 枚举调试探针超时', 'info'); return null; }
  if (probes.length <= 1) return null;          // 单探针 pyocd 不会询问，无需 -u
  const chosen = chooseProbe(probes);
  if (chosen) bus.send(`[烧录] 检测到 ${probes.length} 个调试探针，自动选择: ${chosen.name}（UID ${chosen.uid.slice(0, 8)}…）`, 'info');
  return chosen ? chosen.uid : null;
}

async function checkProbeInfo(cfg = loadConfig()) {
  const resolved = resolvePyocdPath(cfg);
  const pyocd = resolved.pyocd;
  if (!pyocd || (pyocd.includes(path.sep) && !fs.existsSync(pyocd))) {
    return { ok: false, error: `pyOCD 不存在: ${pyocd || '未配置'}`, pyocd };
  }
  const r = await listProbes({ ...cfg, pyocdPath: pyocd });
  if (r.timedOut) return { ok: false, error: '枚举烧录器超时', pyocd, probes: [] };
  const chosen = chooseProbe(r.probes);
  return {
    ok: r.probes.length > 0,
    error: r.probes.length > 0 ? '' : '未检测到烧录器：请确认 PWLink/CMSIS-DAP 已插入、USB 线支持数据传输，并重新插拔后再试',
    pyocd,
    probes: r.probes,
    chosen,
    diagnostic: r.out || ''
  };
}

async function readChipInfo(cfg = loadConfig()) {
  const probeInfo = await checkProbeInfo(cfg);
  if (!probeInfo.ok) return probeInfo;
  const uid = probeInfo.chosen ? probeInfo.chosen.uid : null;
  const pyocd = probeInfo.pyocd;
  let detected = await detectChip({ ...cfg, pyocdPath: pyocd }, uid);
  if (!(detected && detected.detected)) {
    const openocdDetected = await detectChipWithOpenocd(cfg).catch(() => null);
    if (openocdDetected && (openocdDetected.detected || openocdDetected.devid != null)) detected = openocdDetected;
  }
  const target = normalizePyocdTarget(cfg.targetChip);
  await ensurePyocdTarget(pyocd, target);
  return {
    ok: true,
    pyocd,
    probe: probeInfo.chosen || probeInfo.probes[0],
    target,
    detected: !!(detected && detected.detected),
    devid: detected && detected.devid != null ? `0x${detected.devid.toString(16)}` : '',
    name: detected && detected.entry ? detected.entry.name : '',
    timedOut: !!(detected && detected.timedOut),
    diagnostic: detected && detected.out ? summarizeDetectOutput(detected.out) : ''
  };
}

function normalizeDebugHex(value, fallback) {
  const s = String(value || '').trim();
  if (/^0x[0-9a-f]+$/i.test(s)) return s;
  if (/^[0-9a-f]+$/i.test(s)) return `0x${s}`;
  return fallback;
}

function parseDebugAddress(value) {
  const s = normalizeDebugHex(value, '');
  if (!s) return null;
  const n = Number.parseInt(s, 16);
  return Number.isFinite(n) ? n : null;
}

function isFlashAddress(address) {
  return address >= 0x08000000 && address < 0x10000000;
}

async function hardwareDebugCommand(action, opts = {}, cfg = loadConfig()) {
  const resolved = resolvePyocdPath(cfg);
  const pyocd = resolved.pyocd;
  if (!pyocd || (pyocd.includes(path.sep) && !fs.existsSync(pyocd))) {
    return { ok: false, error: `pyOCD 不存在: ${pyocd || '未配置'}`, pyocd };
  }

  const uid = await pickProbeUid({ ...cfg, pyocdPath: pyocd });
  const target = normalizePyocdTarget(cfg.targetChip);
  if (!await ensurePyocdTarget(pyocd, target)) return { ok: false, error: `pyOCD 不支持目标: ${target}`, pyocd, target };

  const probeArg = uid ? ['-u', uid] : [];
  const resetArg = cfg.connectUnderReset ? ['-O', 'connect_mode=under-reset'] : [];
  const address = normalizeDebugHex(opts.address, '0x20000000');
  const value = normalizeDebugHex(opts.value, '0x00000000');
  const count = Math.min(256, Math.max(1, Number(opts.count) || 4));
  const addressNum = parseDebugAddress(address);

  let args;
  let label;
  if (action === 'reset') {
    label = '复位运行';
    args = ['reset', '-t', target, ...probeArg, ...resetArg];
  } else if (action === 'halt') {
    label = '暂停 CPU';
    args = ['cmd', '-t', target, ...probeArg, ...resetArg, '-c', 'halt'];
  } else if (action === 'resume') {
    label = '继续运行';
    args = ['cmd', '-t', target, ...probeArg, ...resetArg, '-c', 'resume'];
  } else if (action === 'erase') {
    label = '整片擦除';
    args = ['erase', '-t', target, ...probeArg, ...resetArg, '--chip'];
  } else if (action === 'read32') {
    label = `读取内存 ${address}`;
    args = ['cmd', '-t', target, ...probeArg, ...resetArg, '-c', `read32 ${address} ${count}`];
  } else if (action === 'write32') {
    if (addressNum == null) return { ok: false, error: `地址格式无效: ${opts.address || ''}` };
    if (isFlashAddress(addressNum)) {
      return {
        ok: false,
        error: `0x${addressNum.toString(16)} 属于 Flash 区，不能用 write32 单字写入。请使用“烧录固件”或“整片擦除”。`,
        address
      };
    }
    label = `写入内存 ${address}`;
    args = ['cmd', '-t', target, ...probeArg, ...resetArg, '-c', `write32 ${address} ${value}`];
  } else {
    return { ok: false, error: `未知硬件调试命令: ${action}` };
  }

  bus.send(`[硬件] ${label}：pyocd ${args.join(' ')}`, 'step');
  const result = await runProcess(pyocd, args, { shell: false, capture: true, clean: cleanPyocd });
  const ok = result.code === 0;
  bus.send(ok ? `[硬件] ✓ ${label}完成` : `[硬件] ✗ ${label}失败 (exit ${result.code})`, ok ? 'success' : 'error');
  return { ok, code: result.code, out: result.out, pyocd, target, address, value, count };
}

function summarizeDetectOutput(out) {
  return String(out || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(-5).join(' / ');
}

async function detectChipWithOpenocd(cfg) {
  const resolved = resolveOpenocdPath(cfg);
  const openocd = resolved.openocd;
  if (!openocd || (openocd.includes(path.sep) && !fs.existsSync(openocd))) return null;
  const target = normalizePyocdTarget(cfg.targetChip);
  const targetCfg = openocdTargetConfig(target);
  const ifaceCfg = cfg.openocdInterface || 'interface/cmsis-dap.cfg';
  const cmd = 'init; targets; echo [capture "mdw 0xe0042000 1"]; echo [capture "mdw 0x40015800 1"]; shutdown';
  const { out, timedOut } = await runCapture(openocd, ['-f', ifaceCfg, '-f', targetCfg, '-c', 'adapter speed 1000', '-c', 'transport select swd', '-c', cmd], {
    shell: false,
    timeoutMs: 15000
  });
  const parsed = parseStm32DevidFromValues(out);
  return Object.assign(parsed, { out, timedOut, source: 'openocd' });
}

async function detectChip(cfg, uid) {
  let lastOut = '';
  let lastVal = null;
  // 先试通用 cortex_m，连不上再用设置里的芯片（它能正常烧录，必然能连上读 IDCODE）
  let timedOut = false;
  const probeArg = uid ? ['-u', uid] : [];
  const resetArg = cfg.connectUnderReset ? ['-O', 'connect_mode=under-reset'] : [];
  const targets = [...new Set(['cortex_m', cfg.targetChip].filter(Boolean))];
  for (const tgt of targets) {
    // 关键：一次连接(=一次硬件复位)内读两个 DBGMCU 地址，避免反复连接把芯片复位多次
    // 加 15s 超时：探针被占用/掉线时 pyocd 会一直挂着，超时则放弃自动识别回退到设置芯片
    const { out, timedOut: to } = await runCapture(
      cfg.pyocdPath,
      ['cmd', '-t', tgt, ...probeArg, ...resetArg, '-c', 'read32 0xe0042000', '-c', 'read32 0x40015800'],
      { shell: false, timeoutMs: 15000 }
    );
    lastOut = out;
    if (to) { timedOut = true; break; }   // 超时不再换目标重试，直接回退

    // 输出形如 "0xe0042000:  0x10036410"，取所有读到的数据值；低 12 位即 DEV_ID
    const tokens = (out.match(/0x[0-9a-fA-F]+/g) || []).map((h) => parseInt(h, 16));
    const vals = tokens.filter((v) => v !== 0xe0042000 && v !== 0x40015800);
    for (const v of vals) {
      if (!v) continue;
      lastVal = v;
      const devid = v & 0xFFF;
      if (DEVID_MAP[devid]) return { detected: true, devid, entry: DEVID_MAP[devid], out };
    }
    // 这次连接已读到值(即便型号表里没有)，说明探针正常，不再换目标重复复位
    if (vals.some((v) => v)) break;
  }
  return { detected: false, out: lastOut, devid: lastVal == null ? null : (lastVal & 0xFFF), timedOut };
}

async function resolveTarget(cfg, uid) {
  if (!cfg.autoDetectChip) return normalizePyocdTarget(cfg.targetChip);
  bus.send('[烧录] 正在识别目标芯片 ...', 'info');
  let res;
  try { res = await detectChip(cfg, uid); } catch { res = { detected: false }; }
  if (res && res.timedOut) {
    const target = normalizePyocdTarget(cfg.targetChip);
    bus.send(`[烧录] ⚠ 芯片识别超时（探针可能被占用/未连接/驱动异常），跳过自动识别，使用目标: ${target}`, 'info');
    return target;
  }
  if (res.detected) {
    const { devid, entry } = res;
    // 设置里的芯片若属同家族则保留（更精确），否则用探测代表型号
    const useConfig = cfg.targetChip && cfg.targetChip.toLowerCase().startsWith(entry.family);
    const target = normalizePyocdTarget(useConfig ? cfg.targetChip : entry.target);
    bus.send(`[烧录] ✓ 识别到 ${entry.name}（DEV_ID 0x${devid.toString(16)}），目标: ${target}`, 'success');
    return target;
  }
  const fallbackTarget = normalizePyocdTarget(cfg.targetChip);
  // 克隆探针（PWLink2 等）不返回 ST IDCODE，识别失败属正常，不刷诊断噪声
  if (res && res.out && /Not a genuine ST Device|Board ID .* not recognized/i.test(res.out)) {
    bus.send(`[烧录] 非原厂/克隆探针无法读取芯片 ID，使用目标: ${fallbackTarget}`, 'info');
  } else {
    bus.send(`[烧录] 未能自动识别芯片，使用目标: ${fallbackTarget}`, 'info');
    if (res && res.devid != null) {
      bus.send(`[烧录] （读到 DEV_ID 0x${res.devid.toString(16)}，不在内置型号表，请反馈我补充）`, 'info');
    } else if (res && res.out) {
      const tail = res.out.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim()).slice(-4).join(' / ');
      if (tail) bus.send(`[烧录] 诊断: ${tail}`, 'info');
    }
  }
  if (fallbackTarget !== String(cfg.targetChip || '').trim().toLowerCase()) {
    bus.send(`[烧录] pyOCD 目标别名: ${cfg.targetChip} -> ${fallbackTarget}`, 'info');
  }
  return fallbackTarget;
}

module.exports = {
  PYOCD_FLASH_TIMEOUT_MS,
  ensurePyocdTarget,
  pickProbeUid,
  checkProbeInfo,
  readChipInfo,
  normalizeDebugHex,
  parseDebugAddress,
  isFlashAddress,
  hardwareDebugCommand,
  resolveTarget
};
