'use strict';

const vscode = require('vscode');
const { installDefaultToolchain, jobLock } = require('../vendor/flash-core');

function createDependencyInstaller(getConfig, output) {
  let activeTask = null;
  let progressReporter = null;
  let progressLabel = '';
  let autoInstallAttempted = false;

  function reportDownload(label, percent) {
    if (!progressReporter) return;
    if (!label) {
      progressReporter.report({ message: '正在完成工具链安装…' });
      return;
    }
    if (label !== progressLabel) {
      progressLabel = label;
    }
    if (percent >= 0) {
      const normalized = Math.max(0, Math.min(100, percent));
      progressReporter.report({
        message: `正在下载 ${label} · ${normalized}%`
      });
    } else {
      progressReporter.report({ message: `正在下载 ${label}…` });
    }
  }

  async function install() {
    const cfg = getConfig();
    if (cfg.projectMode !== 'stm32cube') {
      vscode.window.showInformationMessage('MCU-Assistant: 依赖下载仅用于 STM32Cube 默认工具链');
      return { ok: false, skipped: true };
    }
    if (activeTask) {
      vscode.window.showInformationMessage('MCU-Assistant: 依赖下载正在进行中');
      return activeTask;
    }
    if (jobLock.isBusy()) {
      vscode.window.showWarningMessage('MCU-Assistant: 当前有编译或烧录任务，请稍后再下载依赖');
      return { ok: false, busy: true };
    }

    output.show(true);
    activeTask = Promise.resolve(vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'MCU-Assistant 工具链',
      cancellable: false
    }, async (progress) => {
      progressReporter = progress;
      progressLabel = '';
      progress.report({ message: '正在检查缺失依赖…' });
      const locked = await jobLock.runExclusive('install-dependencies', async () => {
        return installDefaultToolchain(getConfig(), { force: false });
      });
      const result = locked.result || { ok: false, error: locked.error || '依赖安装失败' };
      if (result.ok) {
        vscode.window.showInformationMessage('MCU-Assistant: 工具链依赖安装完成');
      } else {
        vscode.window.showErrorMessage(`MCU-Assistant: ${result.error || '工具链依赖未完全安装'}`);
      }
      return result;
    })).finally(() => {
      activeTask = null;
      progressReporter = null;
      progressLabel = '';
    });
    return activeTask;
  }

  async function maybeAutoInstall(readiness) {
    const cfg = getConfig();
    if (autoInstallAttempted || !cfg.autoDownloadDependencies || cfg.projectMode !== 'stm32cube') return null;
    const detail = String(readiness && readiness.compiler && readiness.compiler.detail || '');
    if (!/未找到\s+(make|arm-none-eabi-gcc)|make\s*\/\s*arm gcc/i.test(detail)) return null;
    autoInstallAttempted = true;
    return install();
  }

  return { install, maybeAutoInstall, reportDownload };
}

module.exports = { createDependencyInstaller };
