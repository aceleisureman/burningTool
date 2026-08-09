'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let extensionStorageRoot = '';

function setExtensionStorageRoot(root) {
  extensionStorageRoot = path.resolve(String(root || '').trim() || path.join(os.homedir(), '.mcu-assistant'));
}

function getExtensionStorageRoot() {
  return extensionStorageRoot || path.join(os.homedir(), '.mcu-assistant');
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
 * 解析插件独立的工具链根 / tools 目录
 * @param {{ toolchainRootPath?: string }} [cfg]
 */
function resolveExtensionRoots(cfg = {}) {
  const userData = getExtensionStorageRoot();
  const repoRoot = findRepoRoot(path.join(__dirname, '..'));
  const custom = String((cfg && cfg.toolchainRootPath) || '').trim();

  let toolchainRoot = '';
  if (custom) {
    toolchainRoot = path.resolve(expandHome(custom));
  } else {
    const extensionTc = path.join(userData, 'toolchain');
    const repoTc = repoRoot ? path.join(repoRoot, 'toolchain') : '';
    if (fs.existsSync(extensionTc)) toolchainRoot = extensionTc;
    else if (repoTc && fs.existsSync(repoTc)) toolchainRoot = repoTc;
    else toolchainRoot = extensionTc;
  }

  const toolsDir = path.join(userData, 'tools');
  return {
    platformId: platformId(),
    userDataDir: userData,
    toolsDir,
    toolchainRoot,
    repoRoot,
    appInstallRoot: repoRoot || userData,
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
    return 'Windows：插件使用独立工具链目录；Keil 仅 Windows 可用';
  }
  if (id === 'macos') {
    return 'macOS：插件使用独立工具链目录；系统 make/openocd 可走 Homebrew';
  }
  return 'Linux：插件使用独立工具链目录；系统包管理器可提供 make/openocd';
}

module.exports = {
  platformId,
  setExtensionStorageRoot,
  getExtensionStorageRoot,
  findRepoRoot,
  resolveExtensionRoots,
  platformHint,
  expandHome
};
