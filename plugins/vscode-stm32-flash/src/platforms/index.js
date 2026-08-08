'use strict';

const { Stm32CubePlatform } = require('./stm32cube');
const { Keil5Platform }     = require('./keil5');
const { Esp32Platform }     = require('./esp32');

/** @type {Map<string, import('./base').PlatformBase>} */
const REGISTRY = new Map();

function register(platform) {
  REGISTRY.set(platform.id, platform);
}

// 注册内置平台
register(new Stm32CubePlatform());
register(new Keil5Platform());
register(new Esp32Platform());

/**
 * 获取当前模式对应的平台处理器
 * @param {string} projectMode
 * @returns {import('./base').PlatformBase}
 */
function getPlatform(projectMode) {
  const p = REGISTRY.get(projectMode);
  if (!p) {
    // 未知模式回退到 stm32cube
    return REGISTRY.get('stm32cube');
  }
  return p;
}

/**
 * 注册自定义平台（供第三方扩展使用）
 * @param {import('./base').PlatformBase} platform
 */
function registerPlatform(platform) {
  if (!platform || !platform.id) throw new Error('Platform must have an id');
  REGISTRY.set(platform.id, platform);
}

/** @returns {import('./base').PlatformBase[]} */
function getAllPlatforms() {
  return Array.from(REGISTRY.values());
}

module.exports = { getPlatform, registerPlatform, getAllPlatforms };
