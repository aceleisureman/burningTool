'use strict';

const vscode = require('vscode');
const { updateSetting } = require('./config');
const { listRecentProjectInfos } = require('./recentStore');
const { t } = require('./i18n');

/**
 * @param {vscode.ExtensionContext} context
 * @param {object} deps
 */
function registerCommands(context, deps) {
  const { service, output, pickProjectDir, ensureProjectDir, provider } = deps;

  const cmds = [
    ['stm32Flash.selectProject', async () => {
      if (!(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length)) {
        const dir = await ensureProjectDir();
        if (!dir) return;
        await service.selectProject(dir, { openInVscode: true });
      } else {
        const dir = await pickProjectDir();
        if (!dir) return;
        await service.selectProject(dir, { openInVscode: true });
      }
      provider.refresh();
    }],
    ['stm32Flash.openRecent', async () => {
      const items = listRecentProjectInfos().map((r) => ({
        label: r.name,
        description: r.exists ? r.parent : t('recent.dir_missing', r.dir),
        detail: r.dir,
        dir: r.dir,
        exists: r.exists
      }));
      if (!items.length) {
        vscode.window.showInformationMessage(t('recent.empty'));
        return;
      }
      const picked = await vscode.window.showQuickPick(items, {
        title: t('recent.title'),
        placeHolder: t('recent.placeholder'),
        matchOnDescription: true,
        matchOnDetail: true
      });
      if (!picked) return;
      if (!picked.exists) {
        const act = await vscode.window.showWarningMessage(
          t('recent.dir_missing', picked.dir),
          t('recent.remove_action')
        );
        if (act === t('recent.remove_action')) await service.removeRecent(picked.dir);
        provider.refresh();
        return;
      }
      await service.openRecent(picked.dir);
      provider.refresh();
    }],
    ['stm32Flash.build', async () => {
      await service.doBuild();
      provider.refresh();
    }],
    ['stm32Flash.flash', async () => {
      await service.doFlash();
      provider.refresh();
    }],
    ['stm32Flash.buildAndFlash', async () => {
      await service.doBuildAndFlash();
      provider.refresh();
    }],
    ['stm32Flash.generateMakefile', async () => {
      await service.doGenerateMakefile();
      provider.refresh();
    }],
    ['stm32Flash.checkProbe', async () => {
      await service.doCheckProbe();
      provider.refresh();
    }],
    ['stm32Flash.readChipInfo', async () => {
      await service.doReadChipInfo();
      provider.refresh();
    }],
    ['stm32Flash.cancel', async () => {
      service.cancel();
      provider.refresh();
    }],
    ['stm32Flash.openOutput', () => output.show(false)],
    ['stm32Flash.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'stm32Flash');
    }]
  ];

  for (const [id, fn] of cmds) {
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('stm32Flash._updateSetting', async (key, value) => {
      await updateSetting(key, value);
      await service.refreshState();
      provider.refresh();
    })
  );
}

module.exports = { registerCommands };
