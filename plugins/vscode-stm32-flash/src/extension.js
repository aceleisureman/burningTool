'use strict';

const os = require('os');
const vscode = require('vscode');
const {
  setPathsContext,
  setConfigLoader,
  bus
} = require('../vendor/flash-core');

const { createOutput } = require('./output');
const { createStatusBar } = require('./statusBar');
const { t } = require('./i18n');
const { loadFlashConfig, setProjectDir, onConfigChange } = require('./config');
const { createFlashService } = require('./flashService');
const {
  detectProject,
  pickProjectDir,
  getProjectDir,
  ensureProjectDir,
  resolveProjectDir,
  openProjectInVscode
} = require('./project');
const { addRecentProject } = require('./recentStore');
const { registerCommands } = require('./commands');
const { Stm32FlashViewProvider } = require('./webview/panel');
const { resolveSharedRoots, platformHint, platformId } = require('./toolchainShare');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const extVersion = context.extension.packageJSON.version || '0.0.0';

  // 与桌面端 MCU 工具箱共用 userData/toolchain/tools（按系统解析）
  const applySharedPaths = () => {
    const cfg = loadFlashConfig();
    const roots = resolveSharedRoots(cfg);
    setPathsContext({
      tempDir: () => os.tmpdir(),
      userDataDir: () => roots.userDataDir,
      toolsDir: () => roots.toolsDir,
      toolchainRoot: () => {
        const c = loadFlashConfig();
        const r = resolveSharedRoots(c);
        return r.toolchainRoot;
      },
      appInstallRoot: () => roots.appInstallRoot,
      // 扩展侧按「安装态」解析：优先 userData/toolchain，并保留仓库 toolchain 作 legacy
      isPackaged: true
    });
    return roots;
  };

  const roots0 = applySharedPaths();
  setConfigLoader(() => loadFlashConfig());

  const output = createOutput();
  const statusBar = createStatusBar();
  bus.setSinks({
    send: (text, type) => output.append(text, type || 'info'),
    sendProgress: (key, text) => output.append(text, 'progress', key),
    sendDownloadProgress: (label, percent) => output.append(`[${t('sys.download')}] ${label} ${percent}%`, 'info')
  });

  const service = createFlashService({
    output,
    statusBar,
    getConfig: loadFlashConfig,
    getProjectDir,
    setProjectDir,
    detectProject,
    ensureProjectDir,
    resolveProjectDir,
    openProjectInVscode
  });

  const provider = new Stm32FlashViewProvider(context.extensionUri, service, extVersion);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(Stm32FlashViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  registerCommands(context, {
    service,
    output,
    pickProjectDir,
    ensureProjectDir,
    provider
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      service.refreshState().catch(() => {});
      provider.refresh();
      const { dir, source } = resolveProjectDir();
      if (dir && source === 'workspace') {
        try { addRecentProject(dir); } catch { /* ignore */ }
        output.append(t('sys.workspace_followed', dir), 'info');
      } else if (!dir) {
        output.append(t('sys.no_workspace'), 'warn');
        statusBar.setIdle(t('status.select'));
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      service.refreshState().catch(() => {});
      provider.refresh();
    }),
    onConfigChange(() => {
      applySharedPaths();
      service.refreshState().catch(() => {});
      provider.refresh();
    }),
    statusBar.item,
    output.channel,
    { dispose: () => bus.setSinks({ send: () => {}, sendProgress: () => {}, sendDownloadProgress: () => {} }) }
  );

  service.refreshState().then((s) => {
    if (!s.project || !s.project.dir) {
      output.append(t('sys.no_workspace'), 'warn');
      statusBar.setIdle(t('status.select'));
    } else if (s.project.source === 'workspace') {
      output.append(t('sys.using_workspace', s.project.dir), 'info');
    } else {
      output.append(t('sys.using_selected', s.project.dir), 'info');
    }
  }).catch(() => {});

  output.append(t('sys.activated'), 'info');
  output.append(t('sys.platform', platformId(), process.platform, process.arch), 'info');
  output.append(t('sys.toolchain', roots0.toolchainRoot) + (roots0.hasToolchain ? '' : t('sys.toolchain_not_installed')), 'info');
  output.append(t('sys.userdata', roots0.userDataDir), 'info');
  if (roots0.hasDesktopConfig) {
    output.append(t('sys.desktop_config'), 'info');
  }
  output.append(`[System] ${platformHint()}`, 'info');
}

function deactivate() {
  try {
    const { killAllRunningProcesses } = require('../vendor/flash-core');
    killAllRunningProcesses('extension-deactivate');
  } catch {
    /* ignore */
  }
}

module.exports = { activate, deactivate };
