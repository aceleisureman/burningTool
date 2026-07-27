'use strict';

const vscode = require('vscode');
const { updateSetting } = require('./config');
const { listRecentProjectInfos } = require('./recentStore');

/**
 * @param {vscode.ExtensionContext} context
 * @param {object} deps
 */
function registerCommands(context, deps) {
  const { service, esp32, output, pickProjectDir, ensureProjectDir, provider } = deps;

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
        description: r.exists ? r.parent : '目录不存在',
        detail: r.dir,
        dir: r.dir,
        exists: r.exists
      }));
      if (!items.length) {
        vscode.window.showInformationMessage('暂无历史工程（与 MCU 工具箱共用）');
        return;
      }
      const picked = await vscode.window.showQuickPick(items, {
        title: '历史工程（MCU 工具箱互通）',
        placeHolder: '选择后将切换 VS Code 到该工程',
        matchOnDescription: true,
        matchOnDetail: true
      });
      if (!picked) return;
      if (!picked.exists) {
        const act = await vscode.window.showWarningMessage(
          `目录不存在：${picked.dir}`,
          '从历史移除'
        );
        if (act === '从历史移除') await service.removeRecent(picked.dir);
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
    }],
    // ── ESP32 ──
    ['esp32.flash', async () => {
      if (!esp32) {
        vscode.window.showWarningMessage('ESP32 服务未就绪');
        return;
      }
      await esp32.doFlash();
      provider.refresh();
    }],
    ['esp32.erase', async () => {
      if (!esp32) return;
      await esp32.doErase();
      provider.refresh();
    }],
    ['esp32.refreshPorts', async () => {
      if (!esp32) return;
      await esp32.refreshPorts();
      provider.refresh();
    }],
    ['esp32.pickFirmware', async () => {
      if (!esp32) return;
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { 'ESP32 固件': ['bin'] },
        openLabel: '选择固件'
      });
      if (uris && uris[0]) esp32.update({ firmwarePath: uris[0].fsPath });
      provider.refresh();
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
