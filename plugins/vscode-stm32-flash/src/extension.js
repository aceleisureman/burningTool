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
const { loadFlashConfig, setProjectDir, onConfigChange } = require('./config');
const { createFlashService } = require('./flashService');
const { createEsp32Service } = require('./esp32Service');
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
    sendDownloadProgress: (label, percent) => output.append(`[下载] ${label} ${percent}%`, 'info')
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

  const esp32 = createEsp32Service({
    output,
    statusBar,
    getConfig: loadFlashConfig
  });

  const provider = new Stm32FlashViewProvider(context.extensionUri, {
    stm32: service,
    esp32
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(Stm32FlashViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  registerCommands(context, {
    service,
    esp32,
    output,
    pickProjectDir,
    ensureProjectDir,
    provider
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      service.refreshState().catch(() => {});
      if (esp32 && esp32.refreshProjectFromWorkspace) esp32.refreshProjectFromWorkspace();
      provider.refresh();
      const { dir, source } = resolveProjectDir();
      if (dir && source === 'workspace') {
        try { addRecentProject(dir); } catch { /* ignore */ }
        output.append(`[系统] 已跟随工作区工程: ${dir}`, 'info');
      } else if (!dir) {
        output.append('[系统] 未打开工作区，请选择工程', 'warn');
        statusBar.setIdle('请选择工程');
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      service.refreshState().catch(() => {});
      if (esp32 && esp32.refreshProjectFromWorkspace) esp32.refreshProjectFromWorkspace();
      provider.refresh();
    }),
    onConfigChange(() => {
      applySharedPaths();
      service.refreshState().catch(() => {});
      if (esp32 && esp32.refreshProjectFromWorkspace) esp32.refreshProjectFromWorkspace();
      provider.refresh();
    }),
    statusBar.item,
    output.channel,
    { dispose: () => bus.setSinks({ send: () => {}, sendProgress: () => {}, sendDownloadProgress: () => {} }) }
  );

  service.refreshState().then((s) => {
    if (!s.project || !s.project.dir) {
      output.append('[系统] 未打开工作区，请选择工程', 'warn');
      statusBar.setIdle('请选择工程');
    } else if (s.project.source === 'workspace') {
      output.append(`[系统] 使用当前 VS Code 工程: ${s.project.dir}`, 'info');
    } else {
      output.append(`[系统] 使用已选工程: ${s.project.dir}`, 'info');
    }
  }).catch(() => {});

  output.append('[系统] MCU-Assistant 已激活（STM32 / ESP32）', 'info');
  output.append(`[系统] 平台: ${platformId()} (${process.platform}/${process.arch})`, 'info');
  output.append(`[系统] 共用工具链: ${roots0.toolchainRoot}${roots0.hasToolchain ? '' : '（尚未安装，可先在 MCU 工具箱安装）'}`, 'info');
  output.append(`[系统] 共用 userData: ${roots0.userDataDir}`, 'info');
  if (roots0.hasDesktopConfig) {
    output.append('[系统] 已读取 MCU 工具箱配置（settings 未填项将回退桌面端路径）', 'info');
  }
  output.append(`[系统] ${platformHint()}`, 'info');
  // 预热 ESP32 esptool / 串口列表
  esp32.refreshTool().catch(() => {});
  esp32.refreshPorts().catch(() => {});
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
