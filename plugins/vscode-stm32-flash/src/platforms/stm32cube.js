'use strict';

const path = require('path');
const {
  compile,
  flash,
  checkProbeInfo,
  readChipInfo,
  detectBuildSystem,
  effectivePaths,
  resolvePyocdPath,
  resolveOpenocdPath
} = require('../../vendor/flash-core');
const { PlatformBase } = require('./base');
const { existsFile, whichSync } = require('./utils');

function resolveMake(cfg) {
  const name = process.platform === 'win32' ? 'make.exe' : 'make';
  const eff = effectivePaths(cfg || {});
  // 1. 用户配置路径（优先，直接 existsFile 不扫 PATH）
  if (eff.makePath) {
    const f = path.join(eff.makePath, name);
    if (existsFile(f)) return f;
    if (existsFile(eff.makePath) && /make(\.exe)?$/i.test(eff.makePath)) return eff.makePath;
  }
  // 2. 系统 PATH（用 where/which，有超时，不阻塞）
  return whichSync(name) || whichSync('make') || '';
}

function resolveArmGcc(cfg) {
  const name = process.platform === 'win32' ? 'arm-none-eabi-gcc.exe' : 'arm-none-eabi-gcc';
  const eff = effectivePaths(cfg || {});
  // 1. 用户配置路径
  if (eff.armGccPath) {
    const f = path.join(eff.armGccPath, name);
    if (existsFile(f)) return f;
    if (existsFile(eff.armGccPath) && /gcc(\.exe)?$/i.test(eff.armGccPath)) return eff.armGccPath;
  }
  // 2. 系统 PATH（用 where/which，有超时，不阻塞）
  return whichSync(name) || whichSync('arm-none-eabi-gcc') || '';
}

class Stm32CubePlatform extends PlatformBase {
  get id() { return 'stm32cube'; }
  get label() { return 'STM32Cube'; }

  detect(dir) {
    if (!dir || !fs.existsSync(dir)) return {};
    const hasMakefile = fs.existsSync(path.join(dir, 'Makefile'));
    return { hasMakefile };
  }

  async checkReadiness(cfg, dir) {
    const c = cfg || {};
    const flashMethod = c.flashMethod || 'pyocd';
    // STM32Cube 模式强制走 make，不受目录内 .uvprojx 影响
    const buildSystem = 'make';

    const compiler = {
      mode: 'make',
      label: 'Make / ARM GCC',
      ok: false, detail: '', path: ''
    };

    const makeBin = resolveMake(c);
    const gccBin  = resolveArmGcc(c);
    compiler.path = makeBin || gccBin || '';
    if (!makeBin && !gccBin) {
      compiler.detail = '未找到 make / arm-none-eabi-gcc';
    } else if (!makeBin) {
      compiler.detail = '未找到 make（GCC 已找到）';
      compiler.path = gccBin;
    } else if (!gccBin) {
      compiler.detail = '未找到 arm-none-eabi-gcc';
      compiler.path = makeBin;
    } else {
      compiler.ok = true;
      compiler.detail = `${path.basename(makeBin)} · ${path.basename(gccBin)}`;
    }

    const flasher = {
      mode: flashMethod,
      label: flashMethod === 'openocd' ? 'OpenOCD' : 'pyOCD',
      ok: false, online: false, detail: '', path: '', probes: []
    };

    if (flashMethod === 'openocd') {
      const resolved = resolveOpenocdPath(c);
      const oocd = resolved.openocd || '';
      flasher.path = oocd;
      if (!oocd || (oocd.includes(path.sep) && !existsFile(oocd))) {
        flasher.detail = `OpenOCD 不存在: ${oocd || '未配置'}`;
      } else {
        flasher.ok = true;
        try {
          const probe = await checkProbeInfo(c);
          flasher.probes = probe.probes || [];
          flasher.online = !!(probe.ok && flasher.probes.length);
          flasher.detail = flasher.online
            ? `OpenOCD 就绪 · 探针 ${flasher.probes.length} 个在线`
            : 'OpenOCD 已安装，但未检测到调试探针';
        } catch {
          flasher.online = false;
          flasher.detail = 'OpenOCD 已安装，探针检测失败';
        }
      }
    } else {
      // pyocd
      const resolved = resolvePyocdPath(c);
      const pyocd = resolved.pyocd || '';
      flasher.path = pyocd;
      if (!pyocd || (pyocd.includes(path.sep) && !existsFile(pyocd))) {
        flasher.detail = `pyOCD 不存在: ${pyocd || '未配置'}`;
      } else {
        flasher.ok = true;
        try {
          const probe = await checkProbeInfo({ ...c, pyocdPath: pyocd });
          flasher.probes = probe.probes || [];
          flasher.online = !!(probe.ok && flasher.probes.length);
          if (flasher.online) {
            const name = (probe.chosen && probe.chosen.name) || (flasher.probes[0] && flasher.probes[0].name) || 'probe';
            flasher.detail = `在线 · ${name}` + (flasher.probes.length > 1 ? ` 等 ${flasher.probes.length} 个` : '');
          } else {
            flasher.detail = probe.error || '未检测到烧录器';
          }
        } catch (e) {
          flasher.online = false;
          flasher.detail = e.message || '探针检测异常';
        }
      }
    }

    const readyForBuild = !!compiler.ok;
    const readyForFlash = !!flasher.ok && !!flasher.online;
    return {
      compiler, flasher,
      readyForBuild, readyForFlash,
      readyForBuildAndFlash: readyForBuild && readyForFlash,
      buildSystem,
      summary: [
        compiler.ok ? `编译器 ✓ ${compiler.label}` : `编译器 ✗ ${compiler.detail}`,
        readyForFlash ? `设备 ✓ ${flasher.detail}` : (flasher.ok ? `设备 ✗ ${flasher.detail}` : `烧录工具 ✗ ${flasher.detail}`)
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

module.exports = { Stm32CubePlatform };
