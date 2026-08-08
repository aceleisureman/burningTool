'use strict';

const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { findExecutableOnPath } = require('../../vendor/flash-core');
const { PlatformBase } = require('./base');
const { existsFile, whichSync } = require('./utils');

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
  const pio = resolvePio();
  if (!pio.ok) {
    const msg = t('esp32.pio_not_found') || '未找到 pio';
    output.append(`[ESP32] ✗ ${msg}`, 'error');
    return { ok: false, error: msg };
  }

  const { spawn } = require('child_process');
  const args = action === 'upload' ? ['run', '-t', 'upload'] : ['run'];

  output.append(`[ESP32] ${path.basename(pio.path)} ${args.join(' ')}`, 'step');

  return new Promise((resolve) => {
    const proc = spawn(pio.path, args, { cwd: dir, shell: false });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      // 实时输出所有非空行
      text.split(/\r?\n/).filter(Boolean).forEach((line) => {
        output.append(`[PIO] ${line.trim()}`, 'info');
      });
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      // 实时输出 stderr（通常是警告/错误）
      text.split(/\r?\n/).filter(Boolean).forEach((line) => {
        output.append(`[PIO stderr] ${line.trim()}`, 'warn');
      });
    });

    proc.on('close', (code) => {
      if (code === 0) {
        output.append(`[ESP32] ✓ ${action === 'upload' ? '烧录成功' : '编译成功'}`, 'success');
        resolve({ ok: true });
      } else {
        output.append(`[ESP32] ✗ ${action === 'upload' ? '烧录失败' : '编译失败'} (exit ${code})`, 'error');
        resolve({ ok: false, error: `pio exit ${code}` });
      }
    });

    proc.on('error', (err) => {
      output.append(`[ESP32] ✗ ${err.message}`, 'error');
      resolve({ ok: false, error: err.message });
    });
  });
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

    const compiler = { mode: 'esp32', label: 'PlatformIO', ok: false, detail: '', path: '' };
    const flasher  = { mode: 'esp32', label: 'PlatformIO', ok: false, online: false, detail: '', path: '', probes: [] };

    if (subMode === 'platformio' || subMode === 'arduino' || subMode === 'idf' || subMode === 'micropython') {
      const pio = resolvePio();
      if (pio.ok) {
        compiler.ok = true;
        compiler.path = pio.path;
        compiler.detail = `pio · ${path.basename(pio.path)}`;
        flasher.ok = true;
        flasher.online = true;
        flasher.path = pio.path;
        flasher.detail = 'PlatformIO CLI 就绪';
        const pioExt = vscode.extensions.getExtension('platformio.platformio-ide');
        if (pioExt && !pioExt.isActive) {
          flasher.online = false;
          flasher.detail = 'PlatformIO IDE 已安装，请重启 VS Code 以激活扩展';
          compiler.detail = 'pio · ' + path.basename(pio.path) + '（需重启 VS Code 激活 PlatformIO IDE）';
        }
      } else {
        const msg = '未找到 pio，请安装 PlatformIO CLI 或 PlatformIO IDE';
        compiler.detail = msg;
        flasher.detail = msg;
      }
      if (compiler.ok && dir && !fs.existsSync(path.join(dir, 'platformio.ini'))) {
        compiler.ok = false;
        compiler.detail = '未找到 platformio.ini';
        flasher.ok = false; flasher.online = false;
        flasher.detail = '未找到 platformio.ini';
      }
    } else {
      const msg = `${subMode} 模式即将支持`;
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

module.exports = { Esp32Platform, resolvePio };
