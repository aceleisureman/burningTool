'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
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
const { setExtensionStorageRoot, resolveExtensionRoots, platformHint, platformId } = require('./toolchainShare');
const { syncPlatformIOToolbar } = require('./platformioToolbar');
const { createDependencyInstaller } = require('./dependencyInstaller');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  setExtensionStorageRoot(context.globalStorageUri.fsPath);
  const extVersion = context.extension.packageJSON.version || '0.0.0';

  // 工具链、辅助工具和历史记录均使用插件自身的全局存储目录。
  const applySharedPaths = () => {
    const cfg = loadFlashConfig();
    const roots = resolveExtensionRoots(cfg);
    setPathsContext({
      tempDir: () => os.tmpdir(),
      userDataDir: () => roots.userDataDir,
      toolsDir: () => roots.toolsDir,
      toolchainRoot: () => {
        const c = loadFlashConfig();
        const r = resolveExtensionRoots(c);
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

  // 静默压制 VS Code 内置的 PlatformIO IDE 推荐弹窗
  suppressPioRecommendation();

  const output = createOutput();
  const statusBar = createStatusBar();
  const dependencyInstaller = createDependencyInstaller(loadFlashConfig, output);
  statusBar.setPort(loadFlashConfig().serialPort);
  syncPlatformIOToolbar(context, loadFlashConfig().hidePlatformIOToolbar).catch(() => {});
  bus.setSinks({
    send: (text, type) => output.append(text, type || 'info'),
    sendProgress: (key, text) => output.append(text, 'progress', key),
    sendDownloadProgress: (label, percent) => {
      dependencyInstaller.reportDownload(label, percent);
      if (label && (percent < 0 || percent % 10 === 0 || percent === 100)) {
        output.append(`[${t('sys.download')}] ${label} ${percent < 0 ? '' : percent + '%'}`, 'progress');
      }
    }
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

  const provider = new Stm32FlashViewProvider(context.extensionUri, service, extVersion, context);
  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider(Stm32FlashViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  registerCommands(context, {
    service,
    output,
    pickProjectDir,
    ensureProjectDir,
    dependencyInstaller
  });

  let activeProjectDir = resolveProjectDir().dir;

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      activeProjectDir = resolveProjectDir().dir;
      service.refreshState().catch(() => {});
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
      const nextProjectDir = resolveProjectDir().dir;
      if (nextProjectDir === activeProjectDir) return;
      activeProjectDir = nextProjectDir;
      service.refreshState().catch(() => {});
    }),
    onConfigChange(() => {
      applySharedPaths();
      const cfg = loadFlashConfig();
      statusBar.setPort(cfg.serialPort);
      syncPlatformIOToolbar(context, cfg.hidePlatformIOToolbar).catch(() => {});
      service.refreshState().catch(() => {});
    }),
    ...statusBar.items,
    output.channel,
    { dispose: () => bus.setSinks({ send: () => {}, sendProgress: () => {}, sendDownloadProgress: () => {} }) }
  );

  service.refreshState().then(async (s) => {
    if (!s.project || !s.project.dir) {
      output.append(t('sys.no_workspace'), 'warn');
      statusBar.setIdle(t('status.select'));
    } else if (s.project.source === 'workspace') {
      output.append(t('sys.using_workspace', s.project.dir), 'info');
    } else {
      output.append(t('sys.using_selected', s.project.dir), 'info');
    }
    const readiness = await service.refreshReadiness(false);
    const installed = await dependencyInstaller.maybeAutoInstall(readiness);
    if (installed && installed.ok) await service.refreshState();
  }).catch(() => {});

  output.append(t('sys.activated'), 'info');
  output.append(t('sys.platform', platformId(), process.platform, process.arch), 'info');
  output.append(t('sys.toolchain', roots0.toolchainRoot) + (roots0.hasToolchain ? '' : t('sys.toolchain_not_installed')), 'info');
  output.append(t('sys.userdata', roots0.userDataDir), 'info');
  output.append(`[System] ${platformHint()}`, 'info');
}

/**
 * 检测 PlatformIO IDE 已安装时，将其加入 workspace 的 unwantedRecommendations，
 * 压制 VS Code 内置的"推荐安装"弹窗。
 */
function suppressPioRecommendation() {
  if (!vscode.extensions.getExtension('platformio.platformio-ide')) return;
  const folders = vscode.workspace.workspaceFolders || [];
  if (!folders.length) return;
  const wsRoot = folders[0].uri.fsPath;
  if (!wsRoot) return;
  const extJsonPath = path.join(wsRoot, '.vscode', 'extensions.json');
  try {
    let extJson = { recommendations: [], unwantedRecommendations: [] };
    if (fs.existsSync(extJsonPath)) {
      const raw = fs.readFileSync(extJsonPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') extJson = parsed;
    }
    const unwanted = extJson.unwantedRecommendations || [];
    if (unwanted.includes('platformio.platformio-ide')) return; // 已存在无需重复添加
    unwanted.push('platformio.platformio-ide');
    extJson.unwantedRecommendations = unwanted;
    fs.mkdirSync(path.dirname(extJsonPath), { recursive: true });
    fs.writeFileSync(extJsonPath, JSON.stringify(extJson, null, 2), 'utf8');
  } catch { /* 静默失败，不影响插件主流程 */ }
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
