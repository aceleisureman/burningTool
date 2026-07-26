'use strict';

const vscode = require('vscode');
const {
  loadDesktopConfig,
  desktopPathFields,
  resolveSharedRoots,
  expandHome
} = require('./toolchainShare');

const SECTION = 'stm32Flash';

function getSection() {
  return vscode.workspace.getConfiguration(SECTION);
}

/**
 * 组装 flash-core 期望的 cfg：
 * VS Code settings 优先，空值回退桌面端 MCU 工具箱 config（含 platformPaths 分平台路径）
 */
function loadFlashConfig() {
  const c = getSection();
  const isWin = process.platform === 'win32';
  const desktop = loadDesktopConfig();
  const d = desktopPathFields(desktop);

  // 对 boolean：若用户未改 VS Code 默认，仍可用桌面端值（inspect）
  const insp = (key) => c.inspect(key);
  function boolSetting(key, desktopVal, fallback) {
    const i = insp(key);
    if (i && (i.workspaceFolderValue !== undefined
      || i.workspaceValue !== undefined
      || i.globalValue !== undefined)) {
      return !!c.get(key);
    }
    if (desktopVal !== undefined && desktopVal !== null) return !!desktopVal;
    return fallback;
  }

  function stringSetting(key, desktopVal, fallback = '') {
    const i = insp(key);
    if (i && (i.workspaceFolderValue !== undefined
      || i.workspaceValue !== undefined
      || i.globalValue !== undefined)) {
      const v = c.get(key);
      return v == null ? fallback : String(v).trim();
    }
    // 未显式配置：桌面端 → 默认
    if (desktopVal != null && String(desktopVal).trim() !== '') return String(desktopVal).trim();
    const def = c.get(key);
    if (def != null && String(def).trim() !== '') return String(def).trim();
    return fallback;
  }

  const toolchainRootPath = stringSetting('toolchainRootPath', d.toolchainRootPath, '');
  const roots = resolveSharedRoots({ toolchainRootPath });

  return {
    targetChip: stringSetting('targetChip', d.targetChip, 'stm32f103c8'),
    flashMethod: stringSetting('flashMethod', d.flashMethod, 'pyocd'),
    buildSystem: stringSetting('buildSystem', d.buildSystem, 'auto'),
    autoDetectChip: boolSetting('autoDetectChip', d.autoDetectChip, true),
    connectUnderReset: boolSetting('connectUnderReset', d.connectUnderReset, false),
    elfName: stringSetting('elfName', d.elfName, ''),
    pyocdPath: expandHome(stringSetting('pyocdPath', d.pyocdPath, '')),
    openocdPath: expandHome(stringSetting('openocdPath', d.openocdPath, '')),
    openocdInterface: stringSetting('openocdInterface', d.openocdInterface, 'interface/cmsis-dap.cfg'),
    armGccPath: expandHome(stringSetting('armGccPath', d.armGccPath, '')),
    makePath: expandHome(stringSetting('makePath', d.makePath, '')),
    keilUV4Path: expandHome(stringSetting(
      'keilUV4Path',
      d.keilUV4Path,
      isWin ? String.raw`C:\Keil_v5\UV4\UV4.exe` : ''
    )),
    keilRebuild: boolSetting('keilRebuild', d.keilRebuild, false),
    cubeMxPath: expandHome(stringSetting('cubeMxPath', d.cubeMxPath, '')),
    toolchainRootPath: toolchainRootPath || roots.toolchainRoot,
    ghProxy: stringSetting('ghProxy', d.ghProxy, ''),
    // 与桌面端共用已下载工具链时默认 default
    toolchainMode: stringSetting('toolchainMode', d.toolchainMode, 'default'),
    platformPaths: (desktop && desktop.platformPaths) || {},
    // 扩展侧元信息（core 忽略多余字段）
    _shared: {
      platformId: roots.platformId,
      userDataDir: roots.userDataDir,
      toolchainRoot: roots.toolchainRoot,
      toolsDir: roots.toolsDir,
      hasDesktopConfig: roots.hasDesktopConfig,
      hasToolchain: roots.hasToolchain
    }
  };
}

function getConfiguredProjectDir() {
  return String(getSection().get('projectDir') || '').trim();
}

/**
 * @param {string} dir
 * @param {boolean} [global]
 */
async function setProjectDir(dir, global = true) {
  const target = global
    ? vscode.ConfigurationTarget.Global
    : vscode.ConfigurationTarget.Workspace;
  await getSection().update('projectDir', dir || '', target);
}

/**
 * @param {string} key
 * @param {any} value
 */
async function updateSetting(key, value) {
  await getSection().update(key, value, vscode.ConfigurationTarget.Global);
}

function onConfigChange(cb) {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(SECTION)) cb();
  });
}

module.exports = {
  SECTION,
  loadFlashConfig,
  getConfiguredProjectDir,
  setProjectDir,
  updateSetting,
  onConfigChange
};
