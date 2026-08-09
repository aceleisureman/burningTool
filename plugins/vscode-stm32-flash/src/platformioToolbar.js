'use strict';

const vscode = require('vscode');

const BACKUP_KEY = 'stm32Flash.platformIOToolbarBackup';

function isEmptyToolbar(value) {
  return Array.isArray(value) && value.length === 0;
}

async function syncPlatformIOToolbar(context, hidden) {
  const config = vscode.workspace.getConfiguration('platformio-ide');
  const inspected = config.inspect('toolbar');
  const globalValue = inspected && inspected.globalValue;

  if (hidden) {
    if (isEmptyToolbar(globalValue)) return;
    if (!context.globalState.get(BACKUP_KEY)) {
      await context.globalState.update(BACKUP_KEY, {
        hadValue: globalValue !== undefined,
        value: globalValue
      });
    }
    await config.update('toolbar', [], vscode.ConfigurationTarget.Global);
    return;
  }

  const backup = context.globalState.get(BACKUP_KEY);
  if (!backup) return;
  await config.update(
    'toolbar',
    backup.hadValue ? backup.value : undefined,
    vscode.ConfigurationTarget.Global
  );
  await context.globalState.update(BACKUP_KEY, undefined);
}

module.exports = { syncPlatformIOToolbar };
