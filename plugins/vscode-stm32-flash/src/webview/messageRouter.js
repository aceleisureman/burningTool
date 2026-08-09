'use strict';

const vscode = require('vscode');
const { updateSetting } = require('../config');

const FLASH_METHODS = new Set(['pyocd', 'openocd', 'keil']);
const PROJECT_MODES = new Set(['stm32cube', 'keil5', 'esp32']);
const ESP32_SUB_MODES = new Set(['platformio', 'arduino', 'idf', 'micropython']);

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

function createMessageRouter(service, refresh) {
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
        case 'setFlashMethod':
          await updateSetting('flashMethod', enumValue(message.value, 'value', FLASH_METHODS));
          await service.refreshState(); return;
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
          const newMode = enumValue(message.value, 'value', PROJECT_MODES);
          await updateSetting('projectMode', newMode);
          const currentCfg = service.getState().cfg || {};
          if (newMode === 'keil5') {
            await updateSetting('flashMethod', 'keil');
          } else if (newMode === 'stm32cube' && currentCfg.flashMethod === 'keil') {
            await updateSetting('flashMethod', 'pyocd');
          }
          await service.refreshState(); return;
        }
        case 'setEsp32SubMode': {
          const subMode = enumValue(message.value, 'value', ESP32_SUB_MODES);
          await updateSetting('esp32SubMode', subMode);
          await service.refreshState(); return;
        }
        case 'installPlatformIO':
          await vscode.commands.executeCommand(
            'workbench.extensions.installExtension',
            'platformio.platformio-ide'
          );
          await service.refreshState(); return;
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
