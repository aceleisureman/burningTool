'use strict';

const fs = require('fs');
const path = require('path');
const {
  detectBuildSystem,
  findKeilProject,
  resolvePyocdPath,
  resolveOpenocdPath,
  findExecutableOnPath,
  effectivePaths,
  checkProbeInfo,
  arduinoCliStatus,
  isArduinoProject
} = require('../vendor/flash-core');

function existsFile(p) {
  try {
    return !!(p && fs.existsSync(p));
  } catch {
    return false;
  }
}

function resolveMake(cfg) {
  const makeName = process.platform === 'win32' ? 'make.exe' : 'make';
  const eff = effectivePaths(cfg || {});
  if (eff.makePath) {
    const asFile = path.join(eff.makePath, makeName);
    if (existsFile(asFile)) return asFile;
    if (existsFile(eff.makePath) && /make(\.exe)?$/i.test(eff.makePath)) return eff.makePath;
  }
  return findExecutableOnPath(makeName) || '';
}

function resolveArmGcc(cfg) {
  const gccName = process.platform === 'win32' ? 'arm-none-eabi-gcc.exe' : 'arm-none-eabi-gcc';
  const eff = effectivePaths(cfg || {});
  if (eff.armGccPath) {
    const asFile = path.join(eff.armGccPath, gccName);
    if (existsFile(asFile)) return asFile;
    if (existsFile(eff.armGccPath) && /gcc(\.exe)?$/i.test(eff.armGccPath)) return eff.armGccPath;
  }
  return findExecutableOnPath(gccName) || '';
}

/**
 * 检查当前编译方式 / 烧录方式对应工具与设备是否就绪。
 * @param {object} cfg
 * @param {string} projectDir
 */
async function checkReadiness(cfg, projectDir) {
  const c = cfg || {};
  const flashMethod = c.flashMethod || 'pyocd';
  const buildSystem = projectDir
    ? detectBuildSystem(projectDir, c)
    : (c.buildSystem === 'keil' ? 'keil' : 'make');

  const compiler = {
    mode: buildSystem === 'keil' ? 'keil' : (buildSystem === 'arduino' ? 'arduino' : 'make'),
    label: buildSystem === 'keil' ? 'Keil UV4' : (buildSystem === 'arduino' ? 'Arduino CLI' : 'Make / ARM GCC'),
    ok: false,
    detail: '',
    path: ''
  };

  if (compiler.mode === 'arduino') {
    try {
      const st = await arduinoCliStatus(c);
      compiler.path = (st && st.command) || '';
      if (st && st.ok) {
        compiler.ok = true;
        compiler.detail = st.version || 'arduino-cli 就绪';
      } else {
        compiler.ok = false;
        compiler.detail = (st && st.error) || '未找到 arduino-cli';
      }
    } catch (e) {
      compiler.ok = false;
      compiler.detail = e.message || 'arduino-cli 检测失败';
    }
  } else if (compiler.mode === 'keil') {
    if (process.platform !== 'win32') {
      compiler.ok = false;
      compiler.detail = 'Keil 仅 Windows 可用';
    } else {
      const uv4 = String(c.keilUV4Path || '').trim();
      compiler.path = uv4;
      if (!uv4 || !existsFile(uv4)) {
        compiler.ok = false;
        compiler.detail = '未找到 UV4.exe，请在设置填写 keilUV4Path';
      } else if (projectDir && !findKeilProject(projectDir)) {
        compiler.ok = false;
        compiler.detail = '工程目录未找到 .uvprojx/.uvproj';
      } else {
        compiler.ok = true;
        compiler.detail = path.basename(uv4);
      }
    }
  } else {
    const makeBin = resolveMake(c);
    const gccBin = resolveArmGcc(c);
    compiler.path = makeBin || gccBin || '';
    if (!makeBin && !gccBin) {
      compiler.ok = false;
      compiler.detail = '未找到 make / arm-none-eabi-gcc';
    } else if (!makeBin) {
      compiler.ok = false;
      compiler.detail = '未找到 make（GCC 已找到）';
      compiler.path = gccBin;
    } else if (!gccBin) {
      // make 在 PATH 上时仍可尝试；但给出警告级：算半就绪，标记 ok=false 更安全
      compiler.ok = false;
      compiler.detail = '未找到 arm-none-eabi-gcc';
      compiler.path = makeBin;
    } else {
      compiler.ok = true;
      compiler.detail = `${path.basename(makeBin)} · ${path.basename(gccBin)}`;
      compiler.path = makeBin;
    }
  }

  const flasher = {
    mode: flashMethod,
    label: flashMethod === 'openocd' ? 'OpenOCD'
      : flashMethod === 'keil' ? 'Keil UV4'
      : flashMethod === 'arduino' ? 'Arduino CLI'
      : (buildSystem === 'arduino' && (flashMethod === 'auto' || flashMethod === 'pyocd') ? 'Arduino CLI' : 'pyOCD'),
    ok: false,
    online: false,
    detail: '',
    path: '',
    probes: []
  };

  const useArduinoUpload = flashMethod === 'arduino'
    || (buildSystem === 'arduino' && (flashMethod === 'auto' || !flashMethod || flashMethod === 'pyocd'));

  if (useArduinoUpload) {
    flasher.mode = 'arduino';
    flasher.label = 'Arduino CLI';
    try {
      const st = await arduinoCliStatus(c);
      flasher.path = (st && st.command) || '';
      if (!(st && st.ok)) {
        flasher.detail = (st && st.error) || '未找到 arduino-cli';
      } else {
        flasher.ok = true;
        const port = String(c.arduinoPort || c.portPath || '').trim();
        if (port) {
          flasher.online = true;
          flasher.detail = `arduino-cli 就绪 · 串口 ${port}`;
        } else {
          flasher.online = false;
          flasher.detail = 'arduino-cli 就绪，但未配置 arduinoPort 串口';
        }
      }
    } catch (e) {
      flasher.detail = e.message || 'arduino-cli 检测失败';
    }
  } else if (flashMethod === 'keil') {
    if (process.platform !== 'win32') {
      flasher.detail = 'Keil 烧录仅 Windows 可用';
    } else {
      const uv4 = String(c.keilUV4Path || '').trim();
      flasher.path = uv4;
      if (!uv4 || !existsFile(uv4)) {
        flasher.detail = '未找到 UV4.exe';
      } else {
        flasher.ok = true;
        flasher.online = true; // Keil 设备在线由 UV4 自身处理，工具就绪即认为可尝试
        flasher.detail = 'UV4 已就绪（设备由 Keil 调试器连接）';
      }
    }
  } else if (flashMethod === 'openocd') {
    const resolved = resolveOpenocdPath(c);
    const openocd = resolved.openocd || '';
    flasher.path = openocd;
    if (!openocd || (openocd.includes(path.sep) && !existsFile(openocd))) {
      flasher.detail = `OpenOCD 不存在: ${openocd || '未配置'}`;
    } else {
      flasher.ok = true;
      // OpenOCD 在线检测：用 pyOCD list 作为探针在线旁证（多数 CMSIS-DAP 场景通用）
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
      // 工具存在即 ok；online 单独表示设备
      if (!flasher.online) flasher.ok = true;
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
  const readyForFlash = !!flasher.ok && (
    flasher.mode === 'keil' || flasher.mode === 'arduino' ? !!flasher.online || flasher.mode === 'keil' : !!flasher.online
  );
  // Arduino: 有串口才 online；Keil 工具在即可
  const readyForFlashFinal = flasher.mode === 'arduino'
    ? (!!flasher.ok && !!flasher.online)
    : (flasher.mode === 'keil' ? !!flasher.ok : (!!flasher.ok && !!flasher.online));
  const readyForBuildAndFlash = readyForBuild && readyForFlashFinal;

  return {
    compiler,
    flasher,
    readyForBuild,
    readyForFlash: readyForFlashFinal,
    readyForBuildAndFlash,
    summary: [
      compiler.ok ? `编译器 ✓ ${compiler.label}` : `编译器 ✗ ${compiler.detail}`,
      flasher.online || (flasher.mode === 'keil' && flasher.ok)
        ? `设备 ✓ ${flasher.detail}`
        : flasher.ok
          ? `设备 ✗ ${flasher.detail}`
          : `烧录工具 ✗ ${flasher.detail}`
    ].join(' · ')
  };
}

module.exports = {
  checkReadiness,
  resolveMake,
  resolveArmGcc
};
