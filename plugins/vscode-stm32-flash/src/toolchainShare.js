'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Electron 桌面端（package.json name = stm32-flasher）的 userData 候选目录。
 * 按平台区分，与 Electron app.getPath('userData') 规则一致。
 */
function electronUserDataCandidates() {
  const home = os.homedir() || '';
  // 优先官方 name；兼容可能的产品名目录
  const names = ['stm32-flasher', 'MCU工具箱', 'mcu-toolbox', 'MCU Toolbox'];
  if (process.platform === 'win32') {
    const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return names.map((n) => path.join(appdata, n));
  }
  if (process.platform === 'darwin') {
    return names.map((n) => path.join(home, 'Library', 'Application Support', n));
  }
  // linux
  const xdg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return names.map((n) => path.join(xdg, n));
}

/**
 * 当前平台 id（与 platform-toolchains / config.platformPaths 一致）
 * @returns {'windows'|'macos'|'linux'}
 */
function platformId() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  return 'linux';
}

/**
 * 定位桌面端 userData：优先含 config.json 或 toolchain/ 的目录。
 */
function findDesktopUserData() {
  const candidates = electronUserDataCandidates();
  for (const d of candidates) {
    try {
      if (fs.existsSync(path.join(d, 'config.json'))) return d;
      if (fs.existsSync(path.join(d, 'toolchain'))) return d;
      if (fs.existsSync(path.join(d, 'tools'))) return d;
    } catch {
      /* ignore */
    }
  }
  return candidates[0] || path.join(os.homedir(), '.stm32-flasher');
}

/**
 * 从扩展目录向上查找 monorepo 根（含 packages/flash-core 或 仓库 toolchain/）
 * @param {string} [startDir]
 */
function findRepoRoot(startDir) {
  let dir = path.resolve(startDir || __dirname);
  for (let i = 0; i < 8; i++) {
    const hasCore = fs.existsSync(path.join(dir, 'packages', 'flash-core', 'package.json'));
    const hasTc = fs.existsSync(path.join(dir, 'toolchain'));
    const hasPkg = fs.existsSync(path.join(dir, 'package.json'))
      && fs.existsSync(path.join(dir, 'src', 'main'));
    if (hasCore || (hasTc && hasPkg)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '';
}

/**
 * 读取桌面端 config.json（若存在）
 */
function loadDesktopConfig() {
  const userData = findDesktopUserData();
  const cfgPath = path.join(userData, 'config.json');
  try {
    if (!fs.existsSync(cfgPath)) return null;
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
}

/**
 * 合并桌面端路径：当前平台 platformPaths 覆盖顶层字段
 */
function desktopPathFields(desktopCfg) {
  if (!desktopCfg) return {};
  const pid = platformId();
  const base = {
    armGccPath: desktopCfg.armGccPath || '',
    makePath: desktopCfg.makePath || '',
    pyocdPath: desktopCfg.pyocdPath || '',
    openocdPath: desktopCfg.openocdPath || '',
    openocdInterface: desktopCfg.openocdInterface || '',
    cubeMxPath: desktopCfg.cubeMxPath || '',
    keilUV4Path: desktopCfg.keilUV4Path || '',
    toolchainRootPath: desktopCfg.toolchainRootPath || '',
    toolchainMode: desktopCfg.toolchainMode || '',
    ghProxy: desktopCfg.ghProxy || '',
    targetChip: desktopCfg.targetChip || '',
    flashMethod: desktopCfg.flashMethod || '',
    buildSystem: desktopCfg.buildSystem || '',
    autoDetectChip: desktopCfg.autoDetectChip,
    connectUnderReset: desktopCfg.connectUnderReset,
    elfName: desktopCfg.elfName || '',
    keilRebuild: desktopCfg.keilRebuild
  };
  const pp = (desktopCfg.platformPaths && desktopCfg.platformPaths[pid]) || {};
  for (const k of ['armGccPath', 'makePath', 'pyocdPath', 'openocdPath', 'cubeMxPath', 'keilUV4Path']) {
    if (pp[k]) base[k] = pp[k];
  }
  return base;
}

/**
 * 解析与桌面端共用的工具链根 / tools 目录
 * @param {{ toolchainRootPath?: string }} [cfg]
 */
function resolveSharedRoots(cfg = {}) {
  const userData = findDesktopUserData();
  const repoRoot = findRepoRoot(path.join(__dirname, '..'));
  const custom = String((cfg && cfg.toolchainRootPath) || '').trim();

  let toolchainRoot = '';
  if (custom) {
    toolchainRoot = path.resolve(expandHome(custom));
  } else {
    const desktopTc = path.join(userData, 'toolchain');
    const repoTc = repoRoot ? path.join(repoRoot, 'toolchain') : '';
    if (fs.existsSync(desktopTc)) toolchainRoot = desktopTc;
    else if (repoTc && fs.existsSync(repoTc)) toolchainRoot = repoTc;
    else toolchainRoot = desktopTc; // 默认与桌面端同路径，安装后即可共用
  }

  const toolsDir = path.join(userData, 'tools');
  return {
    platformId: platformId(),
    userDataDir: userData,
    toolsDir,
    toolchainRoot,
    repoRoot,
    appInstallRoot: repoRoot || userData,
    desktopConfigPath: path.join(userData, 'config.json'),
    hasDesktopConfig: fs.existsSync(path.join(userData, 'config.json')),
    hasToolchain: fs.existsSync(toolchainRoot)
  };
}

function expandHome(p) {
  if (typeof p !== 'string') return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * 平台相关提示文案
 */
function platformHint() {
  const id = platformId();
  if (id === 'windows') {
    return 'Windows：共用 MCU 工具箱 %APPDATA%\\stm32-flasher\\toolchain；Keil 仅 Windows 可用';
  }
  if (id === 'macos') {
    return 'macOS：共用 ~/Library/Application Support/stm32-flasher/toolchain；系统 make/openocd 可走 Homebrew';
  }
  return 'Linux：共用 ~/.config/stm32-flasher/toolchain；系统包管理器可提供 make/openocd';
}

module.exports = {
  platformId,
  electronUserDataCandidates,
  findDesktopUserData,
  findRepoRoot,
  loadDesktopConfig,
  desktopPathFields,
  resolveSharedRoots,
  platformHint,
  expandHome
};
