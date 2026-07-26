const path = require('path');

const GCC_VERSION = '14.2.1-1.1';
const WINDOWS_BUILD_TOOLS_VERSION = '4.4.1-3';
const OPENOCD_VERSION = '0.12.0-7';
const PATH_KEYS = ['armGccPath', 'makePath', 'pyocdPath', 'openocdPath', 'cubeMxPath', 'keilUV4Path'];
const WINDOWS_PATH_RE = /^[a-z]:[\\/]/i;

function gccFileName(platform, arch) {
  if (platform === 'win32') {
    return `xpack-arm-none-eabi-gcc-${GCC_VERSION}-win32-x64.zip`;
  }
  if (platform === 'darwin') {
    const suffix = arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
    return `xpack-arm-none-eabi-gcc-${GCC_VERSION}-${suffix}.tar.gz`;
  }
  if (platform === 'linux') {
    const suffix = arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
    return `xpack-arm-none-eabi-gcc-${GCC_VERSION}-${suffix}.tar.gz`;
  }
  return null;
}

function gccUrl(platform, arch) {
  const fileName = gccFileName(platform, arch);
  return fileName ? `https://github.com/xpack-dev-tools/arm-none-eabi-gcc-xpack/releases/download/v${GCC_VERSION}/${fileName}` : null;
}

function openocdFileName(platform, arch) {
  if (platform === 'win32') return `xpack-openocd-${OPENOCD_VERSION}-win32-x64.zip`;
  if (platform === 'darwin') {
    const suffix = arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
    return `xpack-openocd-${OPENOCD_VERSION}-${suffix}.tar.gz`;
  }
  if (platform === 'linux') {
    const suffix = arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
    return `xpack-openocd-${OPENOCD_VERSION}-${suffix}.tar.gz`;
  }
  return null;
}

function openocdUrl(platform, arch) {
  const fileName = openocdFileName(platform, arch);
  return fileName ? `https://github.com/xpack-dev-tools/openocd-xpack/releases/download/v${OPENOCD_VERSION}/${fileName}` : null;
}

function getPlatformToolchainProfile(platform, arch) {
  const gccFile = gccFileName(platform, arch);
  const gcc = gccUrl(platform, arch);
  const openocdFile = openocdFileName(platform, arch);
  const openocd = openocdUrl(platform, arch);
  if (platform === 'win32') {
    const makeFile = `xpack-windows-build-tools-${WINDOWS_BUILD_TOOLS_VERSION}-win32-x64.zip`;
    return {
      id: 'windows',
      label: 'Windows',
      supportsKeil: true,
      pathDelimiter: ';',
      commandTools: {
        mode: 'busybox',
        label: '编译命令',
        pathDisplay: 'tools\\',
        archiveType: 'exe',
        url: 'https://frippery.org/files/busybox/busybox64u.exe'
      },
      defaultDownloads: {
        gcc: {
          mode: 'download',
          archiveType: 'zip',
          fileName: gccFile,
          url: gcc,
          pathDisplay: 'toolchain\\gcc\\'
        },
        make: {
          mode: 'download',
          archiveType: 'zip',
          fileName: makeFile,
          url: `https://github.com/xpack-dev-tools/windows-build-tools-xpack/releases/download/v${WINDOWS_BUILD_TOOLS_VERSION}/${makeFile}`,
          pathDisplay: 'toolchain\\make\\'
        },
        pyocd: {
          mode: 'venv',
          packageName: 'pyocd',
          pathDisplay: 'toolchain\\pyocd\\'
        },
        openocd: {
          mode: 'download',
          archiveType: 'zip',
          fileName: openocdFile,
          url: openocd,
          pathDisplay: 'toolchain\\openocd\\'
        }
      },
      placeholders: {
        armGccPath: String.raw`如 C:\xpack-arm-none-eabi-gcc\bin`,
        makePath: String.raw`如 C:\xpack-windows-build-tools\bin`,
        pyocdPath: String.raw`如 C:\Python312\Scripts\pyocd.exe`,
        openocdPath: String.raw`如 C:\OpenOCD\bin\openocd.exe`,
        cubeMxPath: String.raw`如 C:\Program Files\STMicroelectronics\STM32Cube\STM32CubeMX\STM32CubeMX.exe`
      }
    };
  }

  if (platform === 'darwin') {
    return {
      id: 'macos',
      label: 'macOS',
      supportsKeil: false,
      pathDelimiter: ':',
      commandTools: {
        mode: 'system',
        label: '系统命令',
        pathDisplay: '/usr/bin'
      },
      defaultDownloads: {
        gcc: {
          mode: gcc ? 'download' : 'none',
          archiveType: 'tar.gz',
          fileName: gccFile,
          url: gcc,
          pathDisplay: 'toolchain/gcc/'
        },
        make: {
          mode: 'system',
          archiveType: null,
          url: null,
          pathDisplay: '/usr/bin/make'
        },
        pyocd: {
          mode: 'venv',
          packageName: 'pyocd',
          pathDisplay: 'toolchain/pyocd/'
        },
        openocd: {
          mode: openocd ? 'download' : 'none',
          archiveType: 'tar.gz',
          fileName: openocdFile,
          url: openocd,
          pathDisplay: 'toolchain/openocd/'
        }
      },
      placeholders: {
        armGccPath: '/opt/homebrew/bin',
        makePath: '/usr/bin',
        pyocdPath: '~/.local/bin/pyocd',
        openocdPath: '/opt/homebrew/bin/openocd',
        cubeMxPath: '/Applications/STMicroelectronics/STM32CubeMX.app/Contents/MacOs/STM32CubeMX'
      }
    };
  }

  return {
    id: 'linux',
    label: 'Linux',
    supportsKeil: false,
    pathDelimiter: ':',
    commandTools: {
      mode: 'system',
      label: '系统命令',
      pathDisplay: '/usr/bin'
    },
    defaultDownloads: {
      gcc: {
        mode: gcc ? 'download' : 'none',
        archiveType: 'tar.gz',
        fileName: gccFile,
        url: gcc,
        pathDisplay: 'toolchain/gcc/'
      },
      make: {
        mode: 'system',
        archiveType: null,
        url: null,
        pathDisplay: '/usr/bin/make'
      },
      pyocd: {
        mode: 'venv',
        packageName: 'pyocd',
        pathDisplay: 'toolchain/pyocd/'
      },
      openocd: {
        mode: openocd ? 'download' : 'none',
        archiveType: 'tar.gz',
        fileName: openocdFile,
        url: openocd,
        pathDisplay: 'toolchain/openocd/'
      }
    },
    placeholders: {
      armGccPath: '/usr/local/bin',
      makePath: '/usr/bin',
      pyocdPath: '/usr/local/bin/pyocd',
      openocdPath: '/usr/bin/openocd',
      cubeMxPath: '/usr/local/STMicroelectronics/STM32CubeMX/STM32CubeMX'
    }
  };
}

function detectExeDir(root, exeName) {
  if (!root) return null;
  return path.join(root, exeName);
}

function pickPathFields(cfg) {
  const out = {};
  for (const key of PATH_KEYS) {
    if (cfg && Object.prototype.hasOwnProperty.call(cfg, key)) out[key] = cfg[key];
  }
  return out;
}

function looksLikeOtherPlatformPath(value, platformId) {
  if (typeof value !== 'string' || !value) return false;
  if (platformId === 'windows') return value.startsWith('/');
  return WINDOWS_PATH_RE.test(value);
}

function applyPlatformPaths(cfg, platformId, defaults = {}) {
  const next = Object.assign({}, cfg);
  const all = Object.assign({}, next.platformPaths || {});
  const current = Object.assign({}, all[platformId] || {});

  for (const key of PATH_KEYS) {
    if (current[key] != null && looksLikeOtherPlatformPath(current[key], platformId)) delete current[key];
    if (current[key] != null && current[key] !== '') next[key] = current[key];
    else if (defaults[key] != null && looksLikeOtherPlatformPath(next[key], platformId)) next[key] = defaults[key];
    else if (defaults[key] != null && (next[key] == null || next[key] === '')) next[key] = defaults[key];
  }
  all[platformId] = Object.assign({}, pickPathFields(next), current);
  next.platformPaths = all;
  return next;
}

function mergeCurrentPlatformPaths(baseCfg, patchCfg, platformId, defaults = {}) {
  const merged = Object.assign({}, baseCfg, patchCfg);
  const all = Object.assign({}, (baseCfg && baseCfg.platformPaths) || {}, (patchCfg && patchCfg.platformPaths) || {});
  all[platformId] = Object.assign({}, all[platformId] || {}, pickPathFields(merged));
  merged.platformPaths = all;
  return applyPlatformPaths(merged, platformId, defaults);
}

function getToolchainDownloadPlan(profile, mode) {
  if (mode !== 'default') {
    return {
      mode,
      downloads: [],
      system: [],
      reason: 'custom-paths'
    };
  }

  const downloads = [];
  const system = [];
  if (profile.commandTools && profile.commandTools.mode === 'busybox') {
    downloads.push({ key: 'commandTools', label: profile.commandTools.label || 'command tools', spec: profile.commandTools });
  } else if (profile.commandTools) {
    system.push({ key: 'commandTools', label: profile.commandTools.label || 'system commands', spec: profile.commandTools });
  }

  const gcc = profile.defaultDownloads && profile.defaultDownloads.gcc;
  if (gcc && gcc.mode === 'download') downloads.push({ key: 'gcc', label: 'gcc', spec: gcc });

  const make = profile.defaultDownloads && profile.defaultDownloads.make;
  if (make && make.mode === 'download') downloads.push({ key: 'make', label: 'make', spec: make });
  else if (make) system.push({ key: 'make', label: 'make', spec: make });

  const pyocd = profile.defaultDownloads && profile.defaultDownloads.pyocd;
  if (pyocd && pyocd.mode === 'venv') downloads.push({ key: 'pyocd', label: 'pyOCD', spec: pyocd });

  const openocd = profile.defaultDownloads && profile.defaultDownloads.openocd;
  if (openocd && openocd.mode === 'download') downloads.push({ key: 'openocd', label: 'OpenOCD', spec: openocd });

  return {
    mode,
    downloads,
    system,
    reason: 'default-downloads'
  };
}

module.exports = {
  getPlatformToolchainProfile,
  detectExeDir,
  applyPlatformPaths,
  mergeCurrentPlatformPaths,
  getToolchainDownloadPlan
};
