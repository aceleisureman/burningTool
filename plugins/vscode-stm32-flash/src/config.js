'use strict';

const vscode = require('vscode');
const {
  resolveExtensionRoots,
  expandHome
} = require('./toolchainShare');

const SECTION = 'stm32Flash';

function getSection() {
  return vscode.workspace.getConfiguration(SECTION);
}

/**
 * 组装 flash-core 期望的 cfg：
 * 所有配置只来自 VS Code 的 stm32Flash.* 设置。
 */
function loadFlashConfig() {
  const c = getSection();
  const isWin = process.platform === 'win32';

  function boolSetting(key, fallback) {
    const value = c.get(key);
    return value == null ? fallback : !!value;
  }

  function stringSetting(key, fallback = '') {
    const value = c.get(key);
    return value == null ? fallback : String(value).trim();
  }

  const toolchainRootPath = stringSetting('toolchainRootPath', '');
  const roots = resolveExtensionRoots({ toolchainRootPath });

  return {
    targetChip: stringSetting('targetChip', 'stm32f103c8'),
    flashMethod: stringSetting('flashMethod', 'pyocd'),
    buildSystem: stringSetting('buildSystem', 'auto'),
    autoDetectChip: boolSetting('autoDetectChip', true),
    connectUnderReset: boolSetting('connectUnderReset', false),
    elfName: stringSetting('elfName', ''),
    pyocdPath: expandHome(stringSetting('pyocdPath', '')),
    openocdPath: expandHome(stringSetting('openocdPath', '')),
    openocdInterface: stringSetting('openocdInterface', 'interface/cmsis-dap.cfg'),
    armGccPath: expandHome(stringSetting('armGccPath', '')),
    makePath: expandHome(stringSetting('makePath', '')),
    keilUV4Path: expandHome(stringSetting(
      'keilUV4Path',
      isWin ? String.raw`C:\Keil_v5\UV4\UV4.exe` : ''
    )),
    keilRebuild: boolSetting('keilRebuild', false),
    cubeMxPath: expandHome(stringSetting('cubeMxPath', '')),
    toolchainRootPath: toolchainRootPath || roots.toolchainRoot,
    ghProxy: stringSetting('ghProxy', ''),
    toolchainMode: stringSetting('toolchainMode', 'default'),
    // 工程模式：stm32cube / keil5 / esp32
    projectMode: stringSetting('projectMode', 'stm32cube'),
    // ESP32 子模式：platformio / arduino / idf / micropython
    esp32SubMode: stringSetting('esp32SubMode', 'platformio'),
    serialPort: stringSetting('serialPort', ''),
    hidePlatformIOToolbar: boolSetting('hidePlatformIOToolbar', true),
    autoDownloadDependencies: boolSetting('autoDownloadDependencies', false),
    platformioCoreDir: stringSetting('platformioCoreDir', ''),
    platformPaths: {},
    // 扩展侧元信息（core 忽略多余字段）
    _runtime: {
      platformId: roots.platformId,
      userDataDir: roots.userDataDir,
      toolchainRoot: roots.toolchainRoot,
      toolsDir: roots.toolsDir,
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
 * @param {boolean} [workspaceScoped] true=写入工作区设置，false=写入全局设置
 */
async function updateSetting(key, value, workspaceScoped = false) {
  const target = workspaceScoped
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  await getSection().update(key, value, target);
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
