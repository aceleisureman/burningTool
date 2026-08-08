'use strict';

const { getPlatform } = require('./platforms/index');

// 保留这些 export 供现有测试兼容
const { resolveMake, resolveArmGcc } = require('./platforms/stm32cube');
const { resolvePio } = require('./platforms/esp32');

/**
 * 检查当前平台编译器 + 烧录设备是否就绪。
 * 委托给平台注册表中对应处理器的 checkReadiness()。
 * @param {object} cfg
 * @param {string} projectDir
 */
async function checkReadiness(cfg, projectDir) {
  const c = cfg || {};
  const platform = getPlatform(c.projectMode || 'stm32cube');
  return platform.checkReadiness(c, projectDir);
}

module.exports = { checkReadiness, resolveMake, resolveArmGcc, resolvePio };
