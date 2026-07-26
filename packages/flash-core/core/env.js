// 运行时环境：平台工具链画像 + 可选配置加载器（桌面端注入 loadConfig，扩展侧用 settings 组装）。
const { getPlatformToolchainProfile } = require('../toolchain/platform-toolchains');

const KEIL_SUPPORTED = process.platform === 'win32';
const PLATFORM_TC = getPlatformToolchainProfile(process.platform, process.arch);

let _loadConfig = () => ({});

function setConfigLoader(fn) {
  _loadConfig = typeof fn === 'function' ? fn : () => ({});
}

function loadConfig() {
  try {
    return _loadConfig() || {};
  } catch {
    return {};
  }
}

module.exports = {
  PLATFORM_TC,
  KEIL_SUPPORTED,
  setConfigLoader,
  loadConfig
};
