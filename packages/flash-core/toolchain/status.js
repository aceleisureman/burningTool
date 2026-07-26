// 主机与默认工具链状态、版本解析和构建环境生成。
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { PLATFORM_TC, loadConfig } = require('../core/env');
const {
  toolsSearchDirs,
  isToolchainInstalled,
  preferredToolchainRoot,
  toolchainSearchRoots,
  migrateLegacyToolchainIfNeeded,
  localPyocdBin,
  localOpenocdBin,
  findExeDir,
  effectivePaths
} = require('./paths');

const APPLETS = [
  'sh', 'rm', 'rmdir', 'mkdir', 'cp', 'mv', 'cat', 'echo', 'touch', 'ls',
  'sed', 'printf', 'test', 'expr', 'true', 'false', 'dirname', 'basename',
  'find', 'grep', 'head', 'tail', 'wc', 'sleep', 'env', 'sort', 'uniq',
  'cut', 'tr', 'xargs', 'date', 'pwd', 'cmp', 'diff'
];

const SYSTEM_COMMAND_TOOLS = {
  macos: [
    'sh', 'zsh', 'rm', 'rmdir', 'mkdir', 'cp', 'mv', 'cat', 'echo', 'touch',
    'ls', 'sed', 'awk', 'printf', 'test', 'find', 'grep', 'head', 'tail',
    'wc', 'sleep', 'env', 'sort', 'uniq', 'cut', 'tr', 'xargs', 'date',
    'pwd', 'dirname', 'basename', 'cmp', 'diff'
  ],
  linux: [
    'sh', 'bash', 'rm', 'rmdir', 'mkdir', 'cp', 'mv', 'cat', 'echo', 'touch',
    'ls', 'sed', 'awk', 'printf', 'test', 'find', 'grep', 'head', 'tail',
    'wc', 'sleep', 'env', 'sort', 'uniq', 'cut', 'tr', 'xargs', 'date',
    'pwd', 'dirname', 'basename', 'cmp', 'diff', 'ln', 'chmod'
  ]
};

function readHostSystemInfo() {
  const info = {
    platform: process.platform,
    arch: process.arch,
    type: os.type(),
    release: os.release(),
    version: os.version ? os.version() : os.release(),
    displayVersion: os.release()
  };
  if (process.platform === 'darwin') {
    const r = spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' });
    if (!r.error && r.status === 0 && r.stdout.trim()) info.displayVersion = r.stdout.trim();
  }
  return info;
}

function systemLogLabel() {
  const info = readHostSystemInfo();
  return `${PLATFORM_TC.label} ${info.displayVersion || info.release || ''} (${info.platform}/${info.arch})`.trim();
}

function defaultToolchainStatus() {
  migrateLegacyToolchainIfNeeded();
  const root = preferredToolchainRoot();
  const gccName = process.platform === 'win32' ? 'arm-none-eabi-gcc.exe' : 'arm-none-eabi-gcc';
  const makeName = process.platform === 'win32' ? 'make.exe' : 'make';
  let gccBin = '';
  let makeBin = PLATFORM_TC.defaultDownloads.make.mode === 'download' ? '' : 'system';
  for (const r of toolchainSearchRoots()) {
    if (!gccBin) gccBin = findExeDir(path.join(r, 'gcc'), gccName) || '';
    if (PLATFORM_TC.defaultDownloads.make.mode === 'download' && !makeBin) {
      makeBin = findExeDir(path.join(r, 'make'), makeName) || '';
    }
  }
  const pyocdBin = fs.existsSync(localPyocdBin()) ? localPyocdBin() : '';
  const openocdBin = localOpenocdBin();
  const busyboxBin = findBusyboxBin();
  return {
    root,
    toolchainRootPath: (function(){ try { return String((loadConfig()||{}).toolchainRootPath||""); } catch { return ""; } })(),
    searchRoots: toolchainSearchRoots(),
    gccBin,
    makeBin,
    busybox: isToolchainInstalled(),
    pyocdBin,
    openocdBin,
    gccVersion: gccBin ? commandVersion(path.join(gccBin, gccName), ['--version'], 'gcc') : '',
    makeVersion: commandVersion(makeBin === 'system' ? 'make' : (makeBin ? path.join(makeBin, makeName) : ''), ['--version'], 'make'),
    pyocdVersion: pyocdBin ? commandVersion(pyocdBin, ['--version'], 'pyocd') : '',
    openocdVersion: openocdBin ? commandVersion(openocdBin, ['--version'], 'openocd') : '',
    busyboxVersion: busyboxBin ? commandVersion(busyboxBin, ['--help'], 'busybox') : '',
    commandTools: supportedCommandTools(),
    platform: PLATFORM_TC.id,
    supportsKeil: PLATFORM_TC.supportsKeil,
    commandToolsMode: PLATFORM_TC.commandTools.mode,
    makeMode: PLATFORM_TC.defaultDownloads.make.mode
  };
}

function supportedCommandTools(platformId = PLATFORM_TC.id) {
  if (platformId === 'windows') return APPLETS.slice();
  return (SYSTEM_COMMAND_TOOLS[platformId] || SYSTEM_COMMAND_TOOLS.linux).slice();
}

function findBusyboxBin() {
  for (const dir of toolsSearchDirs()) {
    const p = path.join(dir, process.platform === 'win32' ? 'busybox.exe' : 'busybox');
    if (fs.existsSync(p)) return p;
  }
  return '';
}

function commandVersion(cmd, args, tool) {
  if (!cmd) return '';
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 2500 });
    const text = `${r.stdout || ''}\n${r.stderr || ''}`;
    return parseToolVersion(tool, text);
  } catch {
    return '';
  }
}

function parseToolVersion(tool, output) {
  const text = String(output || '').trim();
  if (!text) return '';
  let m;
  if (tool === 'gcc') {
    m = text.match(/arm-none-eabi-gcc[^\n]*\s(\d+(?:\.\d+)+(?:[-+.\w]*)?)/i);
    return m ? m[1] : firstVersion(text);
  }
  if (tool === 'make') {
    m = text.match(/GNU Make\s+(\d+(?:\.\d+)+)/i);
    return m ? m[1] : firstVersion(text);
  }
  if (tool === 'pyocd') {
    m = text.match(/(?:pyocd|pyOCD)\s+(\d+(?:\.\d+)+(?:[-+.\w]*)?)/i);
    return m ? m[1] : firstVersion(text);
  }
  if (tool === 'openocd') {
    m = text.match(/(?:Open On-Chip Debugger|OpenOCD)\s+(\d+(?:\.\d+)+(?:[-+.\w]*)?)/i);
    return m ? m[1] : firstVersion(text);
  }
  if (tool === 'busybox') {
    m = text.match(/BusyBox\s+v?(\d+(?:\.\d+)+(?:[-+.\w]*)?)/i);
    return m ? m[1] : firstVersion(text);
  }
  return firstVersion(text);
}

function firstVersion(text) {
  const m = String(text || '').match(/\b\d+(?:\.\d+)+(?:[-+.\w]*)?\b/);
  return m ? m[0] : '';
}

function buildEnv(cfg) {
  const eff = effectivePaths(cfg);
  const pyDir = eff.pyocdPath ? path.dirname(eff.pyocdPath) : '';
  const ocdDir = eff.openocdPath ? path.dirname(eff.openocdPath) : '';
  const extra = [...toolsSearchDirs(), eff.armGccPath, eff.makePath, pyDir, ocdDir].filter(Boolean).join(PLATFORM_TC.pathDelimiter);
  return Object.assign({}, process.env, {
    PATH: extra ? `${extra}${PLATFORM_TC.pathDelimiter}${process.env.PATH}` : process.env.PATH
  });
}

module.exports = {
  APPLETS,
  readHostSystemInfo,
  systemLogLabel,
  defaultToolchainStatus,
  supportedCommandTools,
  parseToolVersion,
  buildEnv
};
