'use strict';

const fs = require('fs');
const path = require('path');
const { findExecutableOnPath, runProcess, runCapture } = require('../../vendor/flash-core');
const { PlatformBase } = require('./base');
const { existsFile, whichSync } = require('./utils');

const DEVICE_CACHE_MS = 2000;
let cachedDevices = [];
let devicesCachedAt = 0;
let deviceListTask = null;

/**
 * 解析 platformio.ini 配置
 * @param {string} iniContent
 * @returns {{ board: string, platform: string, framework: string, uploadSpeed: string, monitorSpeed: string, buildFlags: string }}
 */
function parsePlatformioIni(iniContent) {
  const result = { board: '', platform: '', framework: '', uploadSpeed: '', monitorSpeed: '', buildFlags: '' };
  if (!iniContent) return result;

  // 简单 ini 解析：匹配 key = value 行
  const lines = iniContent.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#') || trimmed.startsWith('[')) continue;

    const m = trimmed.match(/^(\S+)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();

    if (key === 'board') result.board = val;
    else if (key === 'platform') result.platform = val;
    else if (key === 'framework') result.framework = val;
    else if (key === 'upload_speed') result.uploadSpeed = val;
    else if (key === 'monitor_speed') result.monitorSpeed = val;
    else if (key === 'build_flags') result.buildFlags = val;
  }

  return result;
}

function resolvePio() {
  // 先用系统命令（快，有超时）
  const name = process.platform === 'win32' ? 'pio.exe' : 'pio';
  const viaWhich = whichSync(name) || whichSync('pio');
  if (viaWhich) return { ok: true, path: viaWhich };
  // 回退：原有 PATH 遍历（仅在系统命令不可用时）
  const found = findExecutableOnPath(name) || findExecutableOnPath('pio') || '';
  if (found) return { ok: true, path: found };
  // 最后检查硬编码候选路径
  const candidates = process.platform === 'win32'
    ? [path.join(process.env.USERPROFILE || '', '.platformio', 'penv', 'Scripts', 'pio.exe')]
    : [
        path.join(process.env.HOME || '', '.platformio', 'penv', 'bin', 'pio'),
        '/usr/local/bin/pio', '/usr/bin/pio'
      ];
  for (const c of candidates) {
    if (!c.includes('*') && existsFile(c)) return { ok: true, path: c };
  }
  return { ok: false, path: '' };
}

/**
 * 通过 pio CLI 执行 build / upload
 * @param {'build'|'upload'} action
 * @param {{ dir, cfg, output, t }} ctx
 */
async function runPioViaCli(action, { dir, cfg, output, t }) {
  if (!dir || !fs.existsSync(path.join(dir, 'platformio.ini'))) {
    const msg = '未找到有效的 PlatformIO 工程';
    output.append(`[ESP32] ✗ ${msg}`, 'error');
    return { ok: false, error: msg };
  }
  const pio = resolvePio();
  if (!pio.ok) {
    const msg = t('esp32.pio_not_found') || '未找到 pio';
    output.append(`[ESP32] ✗ ${msg}`, 'error');
    return { ok: false, error: msg };
  }

  const args = action === 'upload' ? ['run', '-t', 'upload'] : ['run'];
  const serialPort = String((cfg && cfg.serialPort) || '').trim();
  if (action === 'upload' && serialPort) args.push('--upload-port', serialPort);

  output.append(`[ESP32] ${path.basename(pio.path)} ${args.join(' ')}`, 'step');

  const code = await runProcess(pio.path, args, {
    cwd: dir,
    shell: false,
    windowsHide: true,
    clean: (line) => {
      const text = line.trim();
      if (!text) return null;
      const type = /\b(failed|fatal|error)\b/i.test(text)
        ? 'error'
        : /\bwarning\b/i.test(text)
          ? 'warn'
          : /\b(succeeded|success)\b/i.test(text)
            ? 'success'
            : 'info';
      return { text: `[PIO] ${text}`, type };
    }
  });
  const ok = code === 0;
  output.append(
    `[ESP32] ${ok ? '✓' : '✗'} ${action === 'upload' ? '烧录' : '编译'}${ok ? '成功' : `失败 (exit ${code})`}`,
    ok ? 'success' : 'error'
  );
  return { ok, error: ok ? undefined : `pio exit ${code}` };
}

async function queryPioDevices(pioPath) {
  const pio = pioPath ? { ok: true, path: pioPath } : resolvePio();
  if (!pio.ok) return [];
  const result = await runCapture(pio.path, ['device', 'list', '--json-output'], {
    shell: false,
    windowsHide: true,
    timeoutMs: 10000
  });
  if (result.code !== 0) return [];
  try {
    const start = result.out.indexOf('[');
    const end = result.out.lastIndexOf(']');
    if (start < 0 || end < start) return [];
    const devices = JSON.parse(result.out.slice(start, end + 1));
    if (!Array.isArray(devices)) return [];
    return devices.map((device) => ({
      port: String((device && device.port) || '').trim(),
      description: String((device && device.description) || '').trim(),
      hwid: String((device && device.hwid) || '').trim()
    })).filter((device) => device.port);
  } catch {
    return [];
  }
}

async function listPioDevices(pioPath, force = false) {
  if (!force && Date.now() - devicesCachedAt < DEVICE_CACHE_MS) return cachedDevices.slice();
  if (deviceListTask) return deviceListTask;
  deviceListTask = queryPioDevices(pioPath).then((devices) => {
    cachedDevices = devices;
    devicesCachedAt = Date.now();
    return devices.slice();
  }).finally(() => {
    deviceListTask = null;
  });
  return deviceListTask;
}

class Esp32Platform extends PlatformBase {
  get id() { return 'esp32'; }
  get label() { return 'ESP32'; }

  detect(dir) {
    if (!dir || !fs.existsSync(dir)) {
      return { hasPlatformIO: false, hasArduino: false, hasEspIdf: false, hasMicroPython: false, esp32SubKind: 'unknown', pioFramework: '', pioConfig: null };
    }
    const hasPlatformIO = fs.existsSync(path.join(dir, 'platformio.ini'));
    let hasArduino = false;
    try { hasArduino = fs.readdirSync(dir).some((f) => f.endsWith('.ino')); } catch { /* ignore */ }
    const hasCmake = fs.existsSync(path.join(dir, 'CMakeLists.txt'));
    const hasSdkconfig = fs.existsSync(path.join(dir, 'sdkconfig')) || fs.existsSync(path.join(dir, 'sdkconfig.defaults'));
    const hasIdfYml = fs.existsSync(path.join(dir, 'idf_component.yml'));
    const hasEspIdf = hasCmake && (hasSdkconfig || hasIdfYml);
    const hasMicroPython = fs.existsSync(path.join(dir, 'main.py')) || fs.existsSync(path.join(dir, 'boot.py'));

    let esp32SubKind = 'unknown';
    if (hasPlatformIO) esp32SubKind = 'platformio';
    else if (hasEspIdf) esp32SubKind = 'idf';
    else if (hasArduino) esp32SubKind = 'arduino';
    else if (hasMicroPython) esp32SubKind = 'micropython';

    // 读取 platformio.ini 识别当前 framework 和详细配置
    let pioFramework = '';
    let pioConfig = null;
    if (hasPlatformIO) {
      try {
        const ini = fs.readFileSync(path.join(dir, 'platformio.ini'), 'utf8');
        const m = ini.match(/^\s*framework\s*=\s*(\S+)/im);
        if (m) pioFramework = m[1].toLowerCase();
        pioConfig = parsePlatformioIni(ini);
      } catch { /* ignore */ }
    }

    return { hasPlatformIO, hasArduino, hasEspIdf, hasMicroPython, esp32SubKind, pioFramework, pioConfig };
  }

  async checkReadiness(cfg, dir) {
    const c = cfg || {};
    const subMode = c.esp32SubMode || 'platformio';
    const frameworkLabel = subMode === 'idf'
      ? 'ESP-IDF'
      : subMode === 'arduino'
        ? 'Arduino'
        : subMode === 'micropython'
          ? 'MicroPython'
          : 'PlatformIO';

    const compiler = { mode: 'esp32', label: `PlatformIO / ${frameworkLabel}`, ok: false, detail: '', path: '' };
    const flasher  = { mode: 'esp32', label: 'PlatformIO', ok: false, online: false, detail: '', path: '', probes: [] };

    const pio = resolvePio();
    if (!dir || !fs.existsSync(path.join(dir, 'platformio.ini'))) {
      compiler.detail = `${frameworkLabel} 原生工程暂未支持，请使用 PlatformIO 工程`;
      flasher.detail = '未找到 platformio.ini';
    } else if (pio.ok) {
      compiler.ok = true;
      compiler.path = pio.path;
      compiler.detail = `pio · ${frameworkLabel} · ${path.basename(pio.path)}`;
      flasher.ok = true;
      flasher.path = pio.path;
      const devices = await listPioDevices(pio.path);
      flasher.probes = devices;
      const configuredPort = String(c.serialPort || '').trim();
      const selected = configuredPort
        ? devices.find((device) => device.port.toLowerCase() === configuredPort.toLowerCase())
        : devices[0];
      flasher.online = !!selected;
      flasher.detail = selected
        ? `串口在线 · ${selected.port}`
        : configuredPort
          ? `未检测到已选串口 ${configuredPort}`
          : '未检测到可用串口';
    } else {
      const msg = '未找到 pio，请安装 PlatformIO CLI 或 PlatformIO IDE';
      compiler.detail = msg;
      flasher.detail = msg;
    }

    const readyForBuild = !!compiler.ok;
    const readyForFlash = !!flasher.ok && !!flasher.online;
    return {
      compiler, flasher,
      readyForBuild, readyForFlash,
      readyForBuildAndFlash: readyForBuild && readyForFlash,
      buildSystem: 'platformio',
      summary: [
        compiler.ok ? `编译器 ✓ ${compiler.label}` : `编译器 ✗ ${compiler.detail}`,
        readyForFlash ? `设备 ✓ ${flasher.detail}` : `烧录工具 ✗ ${flasher.detail}`
      ].join(' · ')
    };
  }

  async build(ctx) {
    ctx.output.append(ctx.t('build.section'), 'step');
    return runPioViaCli('build', ctx);
  }

  async flash(ctx) {
    ctx.output.append(ctx.t('flash.section'), 'step');
    return runPioViaCli('upload', ctx);
  }

  async buildAndFlash(ctx) {
    ctx.output.append(ctx.t('one.section'), 'step');
    // PlatformIO upload 会自动先 build
    return runPioViaCli('upload', ctx);
  }

  // checkProbe / readChipInfo 返回 null → 上层跳过
}

module.exports = { Esp32Platform, resolvePio, listPioDevices };
