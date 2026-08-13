'use strict';

const fs = require('fs');
const path = require('path');
const { findExecutableOnPath, runProcess, runCapture } = require('../../vendor/flash-core');
const bus = require('../../vendor/flash-core/core/bus');
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

/**
 * 从 PlatformIO Core 目录解析 pio 可执行文件路径
 * 检查多个可能的位置：
 *   1. <dir>/penv/Scripts/pio.exe  (官方 get-platformio.py 安装)
 *   2. <dir>/Scripts/pio.exe       (pip 直接安装到 core 目录)
 *   3. <dir>/pio.exe               (直接放在 core 目录)
 * @param {string} coreDir
 * @param {object} [output] 可选的日志输出对象
 * @returns {string|null}
 */
function resolvePioFromCoreDir(coreDir, output) {
  if (!coreDir || typeof coreDir !== 'string') return null;
  const dir = coreDir.trim();
  if (!dir) return null;
  const isWin = process.platform === 'win32';
  const exeName = isWin ? 'pio.exe' : 'pio';

  // 目录存在性检查
  if (output) {
    try {
      const dirExists = require('fs').existsSync(dir);
      output.append(`[PlatformIO 诊断] 检查目录: ${dir} (${dirExists ? '存在' : '不存在'})`, 'debug');
      if (dirExists) {
        const entries = require('fs').readdirSync(dir);
        output.append(`[PlatformIO 诊断] 目录内容: ${entries.join(', ')}`, 'debug');
      }
    } catch (e) {
      output.append(`[PlatformIO 诊断] 读取目录失败: ${e.message}`, 'debug');
    }
  }

  // 可能的位置列表
  const candidates = [];
  if (isWin) {
    candidates.push(
      path.join(dir, 'penv', 'Scripts', exeName),  // get-platformio.py 安装
      path.join(dir, 'Scripts', exeName),            // pip 直接安装
      path.join(dir, exeName)                        // 直接放在 core 目录
    );
  } else {
    candidates.push(
      path.join(dir, 'penv', 'bin', exeName),
      path.join(dir, 'bin', exeName),
      path.join(dir, exeName)
    );
  }

  for (const candidate of candidates) {
    if (existsFile(candidate)) {
      if (output && output.append) output.append(`[PlatformIO] 从 ${dir} 找到 pio: ${candidate}`, 'info');
      return candidate;
    }
  }
  if (output && output.append) {
    output.append(`[PlatformIO] 在 ${dir} 下未找到 pio（检查了: ${candidates.join(', ')}）`, 'debug');
  }
  return null;
}

/**
 * 解析 pio 可执行文件路径
 * 查找顺序：
 *   1. PLATFORMIO_CORE_DIR 环境变量 → <dir>/penv/Scripts/pio.exe 或 <dir>/Scripts/pio.exe 或 <dir>/pio.exe
 *   2. cfg.platformioCoreDir 设置 → 同上
 *   3. 系统 PATH（which）
 *   4. 硬编码候选路径 ~/.platformio/penv/...
 * @param {object} [cfg] 可选配置对象，提供 platformioCoreDir 字段
 * @param {object} [output] 可选的日志输出对象
 * @returns {{ ok: boolean, path: string, source: string }}
 */
function resolvePio(cfg, output) {
  // 1. PLATFORMIO_CORE_DIR 环境变量
  const envCoreDir = process.env.PLATFORMIO_CORE_DIR;
  if (envCoreDir) {
    const found = resolvePioFromCoreDir(envCoreDir, output);
    if (found) return { ok: true, path: found, source: 'PLATFORMIO_CORE_DIR' };
  }

  // 2. 配置中的 platformioCoreDir
  const cfgCoreDir = cfg && cfg.platformioCoreDir;
  if (cfgCoreDir) {
    const found = resolvePioFromCoreDir(cfgCoreDir, output);
    if (found) return { ok: true, path: found, source: 'platformioCoreDir' };
  }

  // 3. 系统 PATH（快，有超时）
  const name = process.platform === 'win32' ? 'pio.exe' : 'pio';
  const viaWhich = whichSync(name) || whichSync('pio');
  if (viaWhich) return { ok: true, path: viaWhich, source: 'PATH' };

  // 4. 回退：原有 PATH 遍历
  const found = findExecutableOnPath(name) || findExecutableOnPath('pio') || '';
  if (found) return { ok: true, path: found, source: 'PATH' };

  // 5. 最后检查硬编码候选路径
  const candidates = process.platform === 'win32'
    ? [path.join(process.env.USERPROFILE || '', '.platformio', 'penv', 'Scripts', 'pio.exe')]
    : [
        path.join(process.env.HOME || '', '.platformio', 'penv', 'bin', 'pio'),
        '/usr/local/bin/pio', '/usr/bin/pio'
      ];
  for (const c of candidates) {
    if (!c.includes('*') && existsFile(c)) return { ok: true, path: c, source: 'default' };
  }

  // 全部未找到：输出诊断信息
  if (output && output.append) {
    output.append('[PlatformIO 诊断] PLATFORMIO_CORE_DIR=' + (process.env.PLATFORMIO_CORE_DIR || '(未设置)'), 'warn');
    output.append('[PlatformIO 诊断] platformioCoreDir=' + ((cfg && cfg.platformioCoreDir) || '(未设置)'), 'warn');
    output.append('[PlatformIO 诊断] 已检查路径: env/penv, env/Scripts, env/pio, PATH, 默认路径', 'warn');
  } else {
    // 无 output 时走 bus 日志
    try {
      bus.send('[PlatformIO 诊断] PLATFORMIO_CORE_DIR=' + (process.env.PLATFORMIO_CORE_DIR || '(未设置)'), 'warn');
      bus.send('[PlatformIO 诊断] platformioCoreDir=' + ((cfg && cfg.platformioCoreDir) || '(未设置)'), 'warn');
      bus.send('[PlatformIO 诊断] 所有路径均未找到 pio', 'warn');
    } catch { /* ignore */ }
  }

  return { ok: false, path: '', source: '' };
}

/**
 * 检查 Python 是否可用
 * @returns {{ ok: boolean, path: string, version: string }}
 */
function checkPython() {
  const candidates = process.platform === 'win32'
    ? ['python', 'python3', 'py']
    : ['python3', 'python'];
  for (const name of candidates) {
    const pyPath = whichSync(name);
    if (!pyPath) continue;
    try {
      const result = runCapture(pyPath, ['--version'], {
        shell: false,
        windowsHide: true,
        timeoutMs: 5000
      });
      if (result.code === 0) {
        const version = (result.out || '').trim();
        return { ok: true, path: pyPath, version };
      }
    } catch {
      continue;
    }
  }
  return { ok: false, path: '', version: '' };
}

/**
 * 安装 PlatformIO CLI
 * 使用 get-platformio.py 官方安装脚本
 * @param {{ output: object, cfg: object }} ctx
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function installPlatformioCli(ctx) {
  const { output } = ctx;

  // 1. 检查 Python
  output.append('[PlatformIO] 检查 Python…', 'step');
  const py = checkPython();
  if (!py.ok) {
    const msg = '未找到 Python，请先安装 Python 3.5+（https://python.org）';
    output.append(`[PlatformIO] ✗ ${msg}`, 'error');
    return { ok: false, error: msg };
  }
  output.append(`[PlatformIO] ✓ Python: ${py.path} (${py.version})`, 'success');

  // 2. 确定安装目标目录
  const cfg = ctx.cfg || {};
  const envCoreDir = process.env.PLATFORMIO_CORE_DIR;
  const cfgCoreDir = cfg.platformioCoreDir;
  const targetDir = envCoreDir || cfgCoreDir || '';
  if (targetDir) {
    output.append(`[PlatformIO] 目标目录: ${targetDir}`, 'info');
  }

  // 3. 下载 get-platformio.py
  const installerUrl = 'https://raw.githubusercontent.com/platformio/platformio/master/scripts/get-platformio.py';
  output.append(`[PlatformIO] 下载安装脚本: ${installerUrl}`, 'step');

  const tmpDir = require('os').tmpdir();
  const installerPath = path.join(tmpDir, `get-platformio-${process.pid}.py`);

  try {
    const { downloadFile } = require('../../vendor/flash-core/toolchain/downloader');
    await downloadFile(installerUrl, installerPath, 3, (pct) => {
      if (output && output.append) {
        output.append(`[PlatformIO] 下载安装脚本 ${Math.round(pct)}%`, 'progress');
      }
    });
  } catch (e) {
    const msg = `下载安装脚本失败: ${e && e.message ? e.message : String(e)}`;
    output.append(`[PlatformIO] ✗ ${msg}`, 'error');
    return { ok: false, error: msg };
  }

  if (!existsFile(installerPath)) {
    const msg = '安装脚本下载后未找到';
    output.append(`[PlatformIO] ✗ ${msg}`, 'error');
    return { ok: false, error: msg };
  }

  // 4. 执行安装脚本
  output.append('[PlatformIO] 正在安装 PlatformIO CLI…', 'step');
  const env = Object.assign({}, process.env);
  if (targetDir) env.PLATFORMIO_CORE_DIR = targetDir;

  const code = await runProcess(py.path, [installerPath], {
    cwd: tmpDir,
    shell: false,
    windowsHide: true,
    env,
    clean: (line) => {
      const text = line.trim();
      if (!text) return null;
      const type = /\b(error|failed|fatal)\b/i.test(text)
        ? 'error'
        : /\b(warning|warn)\b/i.test(text)
          ? 'warn'
          : /\b(installing|download|unpack|extract)\b/i.test(text)
            ? 'progress'
            : 'info';
      return { text: `[PIO-INSTALL] ${text}`, type };
    }
  });

  // 清理临时文件
  try { fs.unlinkSync(installerPath); } catch { /* ignore */ }

  if (code !== 0) {
    const msg = `PlatformIO CLI 安装失败 (exit ${code})`;
    output.append(`[PlatformIO] ✗ ${msg}`, 'error');
    return { ok: false, error: msg };
  }

  output.append('[PlatformIO] ✓ PlatformIO CLI 安装完成', 'success');

  // 5. 验证安装
  const pio = resolvePio(cfg, output);
  if (pio.ok) {
    output.append(`[PlatformIO] ✓ pio 已就绪: ${pio.path}`, 'success');
    return { ok: true, pioPath: pio.path };
  }
  const msg = 'PlatformIO CLI 安装完成但未找到 pio 可执行文件，请尝试重启 VS Code';
  output.append(`[PlatformIO] ⚠ ${msg}`, 'warn');
  return { ok: false, error: msg };
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
  const pio = resolvePio(cfg, output);
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

  async checkReadiness(cfg, dir, output) {
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

    const pio = resolvePio(c, output);
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

module.exports = { Esp32Platform, resolvePio, listPioDevices, installPlatformioCli, checkPython };