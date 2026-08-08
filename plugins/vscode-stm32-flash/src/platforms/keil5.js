'use strict';

const fs = require('fs');
const path = require('path');
const {
  compile,
  flash,
  checkProbeInfo,
  readChipInfo,
  findKeilProject,
  effectivePaths
} = require('../../vendor/flash-core');
const { PlatformBase } = require('./base');

function existsFile(p) {
  try { return !!(p && fs.existsSync(p)); } catch { return false; }
}

/** 从 TOOLS.INI 读取 Keil 版本号 */
function resolveKeilUV4(cfg) {
  const c = cfg || {};
  const uv4 = String(c.keilUV4Path || '').trim();
  const result = { path: uv4, exists: false, version: '', installDir: '', detail: '' };
  if (!uv4) return result;
  result.exists = existsFile(uv4);
  if (!result.exists) return result;
  try {
    const installDir = path.dirname(path.dirname(uv4));
    result.installDir = installDir;
    const toolsIni = path.join(installDir, 'TOOLS.INI');
    if (existsFile(toolsIni)) {
      const content = fs.readFileSync(toolsIni, 'utf8');
      const m = content.match(/VERSION\s*=\s*(.+)/i);
      if (m) result.version = m[1].trim();
    }
  } catch { /* ignore */ }
  result.detail = 'UV4.exe' + (result.version ? ` · ${result.version}` : '');
  return result;
}

class Keil5Platform extends PlatformBase {
  get id() { return 'keil5'; }
  get label() { return 'Keil5'; }

  detect(dir) {
    if (!dir || !fs.existsSync(dir)) return {};
    const keilProj = findKeilProject(dir);
    return {
      hasKeil: !!keilProj,
      keilProject: keilProj ? path.basename(keilProj) : ''
    };
  }

  async checkReadiness(cfg, dir) {
    const c = cfg || {};

    if (process.platform !== 'win32') {
      const notWin = { ok: false, detail: 'Keil 仅 Windows 可用', label: 'Keil UV4', mode: 'keil', path: '' };
      return {
        compiler: notWin, flasher: { ...notWin, online: false, probes: [] },
        readyForBuild: false, readyForFlash: false, readyForBuildAndFlash: false,
        summary: 'Keil 仅 Windows 可用'
      };
    }

    const keil = resolveKeilUV4(c);

    const compiler = {
      mode: 'keil', label: 'Keil UV4',
      ok: false, detail: '', path: keil.path,
      version: keil.version, installDir: keil.installDir
    };

    if (!keil.path) {
      compiler.detail = '请在设置填写 keilUV4Path';
    } else if (!keil.exists) {
      compiler.detail = `未找到 UV4.exe: ${keil.path}`;
    } else if (dir && !findKeilProject(dir)) {
      compiler.detail = '工程目录未找到 .uvprojx/.uvproj';
    } else {
      compiler.ok = true;
      compiler.detail = keil.detail;
    }

    const flasher = {
      mode: 'keil', label: 'Keil UV4',
      ok: false, online: false, detail: '', path: keil.path, probes: []
    };

    if (!keil.path || !keil.exists) {
      flasher.detail = compiler.detail || '未找到 UV4.exe';
    } else {
      flasher.ok = true;
      flasher.online = true; // 设备由 Keil 自身管理
      flasher.detail = 'UV4 已就绪（设备由 Keil 调试器连接）';
    }

    const readyForBuild = !!compiler.ok;
    const readyForFlash = !!flasher.ok;
    return {
      compiler, flasher,
      readyForBuild, readyForFlash,
      readyForBuildAndFlash: readyForBuild && readyForFlash,
      buildSystem: 'keil',
      summary: [
        compiler.ok ? `编译器 ✓ ${compiler.detail}` : `编译器 ✗ ${compiler.detail}`,
        flasher.ok ? `设备 ✓ ${flasher.detail}` : `烧录工具 ✗ ${flasher.detail}`
      ].join(' · ')
    };
  }

  async build({ dir, cfg, output, t }) {
    output.append(t('build.section'), 'step');
    output.append(t('build.project', dir), 'info');
    const ok = await compile(dir, cfg);
    output.append(ok ? t('build.done') : t('build.fail'), ok ? 'success' : 'error');
    return { ok: !!ok };
  }

  async flash({ dir, cfg, output, t }) {
    output.append(t('flash.section'), 'step');
    output.append(t('build.project', dir), 'info');
    const ok = await flash(dir, cfg);
    output.append(ok ? t('flash.done') : t('flash.fail'), ok ? 'success' : 'error');
    return { ok: !!ok };
  }

  async buildAndFlash({ dir, cfg, output, t }) {
    output.append(t('one.section'), 'step');
    output.append(t('build.project', dir), 'info');
    const buildOk = await compile(dir, cfg);
    if (!buildOk) {
      output.append(t('one.build_fail'), 'error');
      return { ok: false, buildOk: false, flashOk: false };
    }
    const flashOk = await flash(dir, cfg);
    output.append(flashOk ? t('one.done') : t('one.flash_fail'), flashOk ? 'success' : 'error');
    return { ok: !!flashOk, buildOk: true, flashOk: !!flashOk };
  }

  async checkProbe(cfg) {
    return checkProbeInfo(cfg);
  }

  async readChipInfo(cfg) {
    return readChipInfo(cfg);
  }
}

module.exports = { Keil5Platform, resolveKeilUV4 };
