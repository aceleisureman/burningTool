'use strict';

const vscode = require('vscode');
const { updateSetting } = require('../config');
const { installPlatformioCli } = require('../platforms/esp32');

const FLASH_METHODS = new Set(['pyocd', 'openocd', 'keil']);
const PROJECT_MODES = new Set(['stm32cube', 'keil5', 'esp32']);
const ESP32_SUB_MODES = new Set(['platformio', 'arduino', 'idf', 'micropython']);

const FLASH_METHOD_BY_MODE_KEY = 'flashMethodByMode';

const DEFAULT_FLASH_METHOD_BY_MODE = {
  stm32cube: 'pyocd',
  keil5: 'keil',
  esp32: 'pyocd'
};

function stringValue(value, field, maxLength = 32768) {
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string`);
  const result = value.trim();
  if (!result || result.length > maxLength || result.includes('\0')) {
    throw new RangeError(`${field} is invalid`);
  }
  return result;
}

function booleanValue(value, field) {
  if (typeof value !== 'boolean') throw new TypeError(`${field} must be a boolean`);
  return value;
}

function enumValue(value, field, allowed) {
  const result = stringValue(value, field, 32);
  if (!allowed.has(result)) throw new RangeError(`${field} is not supported`);
  return result;
}

function recentPathValue(service, value) {
  const requested = stringValue(value, 'dir');
  const recent = service.getState().recent || [];
  const allowed = recent.some((item) => item && item.dir === requested);
  if (!allowed) throw new RangeError('dir is not a recent project');
  return requested;
}

/**
 * 从 globalState 读取各模式记忆的烧录方式
 * @param {vscode.ExtensionContext} [context]
 * @returns {object}
 */
function loadFlashMethodByMode(context) {
  if (!context || !context.globalState) return Object.assign({}, DEFAULT_FLASH_METHOD_BY_MODE);
  const saved = context.globalState.get(FLASH_METHOD_BY_MODE_KEY);
  if (saved && typeof saved === 'object') {
    return Object.assign({}, DEFAULT_FLASH_METHOD_BY_MODE, saved);
  }
  return Object.assign({}, DEFAULT_FLASH_METHOD_BY_MODE);
}

/**
 * 保存各模式记忆的烧录方式到 globalState
 * @param {vscode.ExtensionContext} [context]
 * @param {object} map
 */
async function saveFlashMethodByMode(context, map) {
  if (!context || !context.globalState) return;
  await context.globalState.update(FLASH_METHOD_BY_MODE_KEY, map);
}

function createMessageRouter(service, refresh, context) {
  return async function routeMessage(message) {
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') return;

    try {
      switch (message.type) {
        case 'ready': refresh(true); return;
        case 'selectProject':
          await vscode.commands.executeCommand('stm32Flash.selectProject'); return;
        case 'openRecent':
          await service.openRecent(recentPathValue(service, message.dir)); return;
        case 'removeRecent':
          await service.removeRecent(recentPathValue(service, message.dir)); return;
        case 'build': await service.doBuild(); return;
        case 'flash': await service.doFlash(); return;
        case 'buildAndFlash': await service.doBuildAndFlash(); return;
        case 'generateMakefile': await service.doGenerateMakefile(); return;
        case 'checkProbe': await service.doCheckProbe(); return;
        case 'readChipInfo': await service.doReadChipInfo(); return;
        case 'cancel': service.cancel(); return;
        case 'openOutput':
          await vscode.commands.executeCommand('stm32Flash.openOutput'); return;
        case 'openSettings':
          await vscode.commands.executeCommand('stm32Flash.openSettings'); return;
        case 'setFlashMethod': {
          const newMethod = enumValue(message.value, 'value', FLASH_METHODS);
          await updateSetting('flashMethod', newMethod, true); // 工作区隔离
          // 同步保存到当前模式的记忆
          const fmCfg = service.getState().cfg || {};
          const fmMode = fmCfg.projectMode || 'stm32cube';
          const fmMap = loadFlashMethodByMode(context);
          fmMap[fmMode] = newMethod;
          await saveFlashMethodByMode(context, fmMap);
          await service.refreshState(); return;
        }
        case 'setAutoDetect':
          await updateSetting('autoDetectChip', booleanValue(message.value, 'value'));
          await service.refreshState(); return;
        case 'setUnderReset':
          await updateSetting('connectUnderReset', booleanValue(message.value, 'value'));
          await service.refreshState(); return;
        case 'setAutoDownloadDependencies':
          await updateSetting('autoDownloadDependencies', booleanValue(message.value, 'value'));
          await service.refreshState(); return;
        case 'installDependencies':
          await vscode.commands.executeCommand('stm32Flash.installDependencies'); return;
        case 'setProjectMode': {
          const currentCfg = service.getState().cfg || {};
          const currentMode = currentCfg.projectMode || 'stm32cube';
          const newMode = enumValue(message.value, 'value', PROJECT_MODES);
          if (newMode === currentMode) return;

          // 保存当前模式的烧录方式
          const flashMethodMap = loadFlashMethodByMode(context);
          flashMethodMap[currentMode] = currentCfg.flashMethod || DEFAULT_FLASH_METHOD_BY_MODE[currentMode] || 'pyocd';

          // 恢复目标模式的烧录方式
          const targetFlashMethod = flashMethodMap[newMode] || DEFAULT_FLASH_METHOD_BY_MODE[newMode] || 'pyocd';

          // 更新设置（projectMode 和 flashMethod 都写入工作区，实现多窗口隔离）
          await updateSetting('projectMode', newMode, true);
          await updateSetting('flashMethod', targetFlashMethod, true);
          await saveFlashMethodByMode(context, flashMethodMap);

          await service.refreshState(); return;
        }
        case 'setEsp32SubMode': {
          const subMode = enumValue(message.value, 'value', ESP32_SUB_MODES);
          await updateSetting('esp32SubMode', subMode, true); // 工作区隔离
          await service.refreshState(); return;
        }
        case 'installPlatformIO':
          await vscode.commands.executeCommand(
            'workbench.extensions.installExtension',
            'platformio.platformio-ide'
          );
          await service.refreshState(); return;
        case 'installPlatformioCli': {
          const cfg = service.getState().cfg || {};
          await service.installPlatformioCli(cfg);
          await service.refreshState(); return;
        }
        default: return;
      }
    } catch (error) {
      vscode.window.showErrorMessage(`MCU-Assistant: ${error.message || error}`);
    } finally {
      refresh();
    }
  };
}

module.exports = { createMessageRouter, stringValue, booleanValue, enumValue };