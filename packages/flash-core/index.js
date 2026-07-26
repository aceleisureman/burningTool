// @mcu-toolbox/flash-core 公共入口
const bus = require('./core/bus');
const jobLock = require('./core/job-lock');
const { setPathsContext, getPathsContext } = require('./core/paths-context');
const { setConfigLoader, loadConfig, PLATFORM_TC, KEIL_SUPPORTED } = require('./core/env');
const flash = require('./flash/flasher');
const toolchain = require('./toolchain/toolchain');
const proc = require('./toolchain/proc');

module.exports = {
  bus,
  jobLock,
  setPathsContext,
  getPathsContext,
  setConfigLoader,
  loadConfig,
  PLATFORM_TC,
  KEIL_SUPPORTED,
  flash,
  toolchain,
  proc,
  // 常用领域 API 扁平导出，便于扩展侧直接解构
  ...flash,
  ...toolchain,
  runProcess: proc.runProcess,
  runCapture: proc.runCapture,
  killAllRunningProcesses: proc.killAllRunningProcesses
};
