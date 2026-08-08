'use strict';

const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { updateSetting } = require('../config');
const { t, locale } = require('../i18n');

// platformio.ini 的 framework 映射
const PIO_FRAMEWORK_MAP = {
  platformio: '',
  arduino: 'arduino',
  idf: 'espidf',
  micropython: 'micropython'
};

class Stm32FlashViewProvider {
  static viewType = 'stm32Flash.sidebar';

  /**
   * @param {vscode.Uri} extensionUri
   * @param {*} service
   * @param {string} version
   */
  constructor(extensionUri, service, version) {
    this._extensionUri = extensionUri;
    this._service = service;
    this._version = version || '0.0.0';
    /** @type {vscode.WebviewView | undefined} */
    this._view = undefined;
    this._onState = () => this.refresh();
    service.on('state', this._onState);
  }

  /**
   * @param {vscode.WebviewView} webviewView
   */
  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };
    webviewView.webview.html = this._getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (!msg || !msg.type) return;
      try {
        switch (msg.type) {
          case 'ready':
            this.refresh();
            break;
          case 'selectProject':
            await vscode.commands.executeCommand('stm32Flash.selectProject');
            break;
          case 'openRecent':
            if (msg.dir) await this._service.openRecent(msg.dir);
            break;
          case 'removeRecent':
            if (msg.dir) await this._service.removeRecent(msg.dir);
            break;
          case 'build':
            await this._service.doBuild();
            break;
          case 'flash':
            await this._service.doFlash();
            break;
          case 'buildAndFlash':
            await this._service.doBuildAndFlash();
            break;
          case 'generateMakefile':
            await this._service.doGenerateMakefile();
            break;
          case 'checkProbe':
            await this._service.doCheckProbe();
            break;
          case 'readChipInfo':
            await this._service.doReadChipInfo();
            break;
          case 'cancel':
            this._service.cancel();
            break;
          case 'openOutput':
            await vscode.commands.executeCommand('stm32Flash.openOutput');
            break;
          case 'openSettings':
            await vscode.commands.executeCommand('stm32Flash.openSettings');
            break;
          case 'setFlashMethod':
            await updateSetting('flashMethod', msg.value);
            await this._service.refreshState();
            break;
          case 'setAutoDetect':
            await updateSetting('autoDetectChip', !!msg.value);
            await this._service.refreshState();
            break;
          case 'setUnderReset':
            await updateSetting('connectUnderReset', !!msg.value);
            await this._service.refreshState();
            break;
          case 'setProjectMode': {
            const newMode = msg.value;
            await updateSetting('projectMode', newMode);
            // 切换模式时自动修正 flashMethod
            const currentCfg = this._service.getState().cfg || {};
            if (newMode === 'keil5') {
              await updateSetting('flashMethod', 'keil');
            } else if (newMode === 'stm32cube') {
              // stm32cube 不支持 keil 烧录方式，回退到 pyocd
              if (currentCfg.flashMethod === 'keil') {
                await updateSetting('flashMethod', 'pyocd');
              }
            } else if (newMode === 'esp32') {
              // esp32 模式不使用 flashMethod，不需要改
            }
            await this._service.refreshState();
            break;
          }
          case 'setEsp32SubMode':
            await updateSetting('esp32SubMode', msg.value);
            // 同步修改 platformio.ini 的 framework 字段
            const proj = this._service.getState().project || {};
            const iniDir = proj.dir || '';
            if (iniDir) {
              const iniPath = path.join(iniDir, 'platformio.ini');
              const targetFramework = PIO_FRAMEWORK_MAP[msg.value] || '';
              if (targetFramework) {
                try {
                  if (fs.existsSync(iniPath)) {
                    let ini = fs.readFileSync(iniPath, 'utf8');
                    if (/^\s*framework\s*=/im.test(ini)) {
                      ini = ini.replace(/^\s*framework\s*=\s*\S+/im, `framework = ${targetFramework}`);
                    } else {
                      ini += `\nframework = ${targetFramework}\n`;
                    }
                    fs.writeFileSync(iniPath, ini, 'utf8');
                  }
                } catch (e) {
                  vscode.window.showWarningMessage(`MCU-Assistant: ${t('esp32.framework_switch_fail', e.message)}`);
                }
              }
            }
            await this._service.refreshState();
            break;
          case 'installPlatformIO':
            await vscode.commands.executeCommand(
              'workbench.extensions.installExtension',
              'platformio.platformio-ide'
            );
            await this._service.refreshState();
            break;
          default:
            break;
        }
      } catch (e) {
        vscode.window.showErrorMessage(`MCU-Assistant: ${e.message || e}`);
      } finally {
        this.refresh();
      }
    });
    this.refresh();
  }

  refresh() {
    if (!this._view) return;
    this._view.webview.postMessage({ type: 'state', state: this._service.getState() });
  }

  /**
   * @param {vscode.Webview} webview
   */
  _getHtml(webview) {
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource} 'unsafe-inline'`
    ].join('; ');

    const currentLocale = locale();
    const version = this._version || '0.0.0';

    return `<!DOCTYPE html>
<html lang="${currentLocale === 'zh-cn' ? 'zh-CN' : 'en'}">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root {
      color-scheme: light dark;
      --r: 5px;
      --r-sm: 3px;
      --fg: var(--vscode-foreground);
      --fg-muted: var(--vscode-descriptionForeground);
      --bg: var(--vscode-sideBar-background);
      --bg-elevated: var(--vscode-input-background);
      --bg-hover: var(--vscode-list-hoverBackground);
      --border: var(--vscode-sideBar-border, var(--vscode-panel-border, var(--vscode-widget-border)));
      --focus: var(--vscode-focusBorder);
      --btn-bg: var(--vscode-button-background);
      --btn-fg: var(--vscode-button-foreground);
      --btn-hover: var(--vscode-button-hoverBackground);
      --btn2-bg: var(--vscode-button-secondaryBackground);
      --btn2-fg: var(--vscode-button-secondaryForeground);
      --btn2-hover: var(--vscode-button-secondaryHoverBackground);
      --badge-bg: var(--vscode-badge-background);
      --badge-fg: var(--vscode-badge-foreground);
      --ok-fg: var(--vscode-testing-iconPassed, var(--vscode-gitDecoration-addedResourceForeground));
      --ok-bg: var(--vscode-inputValidation-infoBackground);
      --warn-fg: var(--vscode-editorWarning-foreground, var(--vscode-list-warningForeground));
      --warn-bg: var(--vscode-inputValidation-warningBackground);
      --err-fg: var(--vscode-errorForeground, var(--vscode-list-errorForeground));
      --err-bg: var(--vscode-inputValidation-errorBackground);
      --err-bd: var(--vscode-inputValidation-errorBorder);
      --font: var(--vscode-font-family);
      --font-mono: var(--vscode-editor-font-family);
    }
    * { box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      background: var(--bg) !important;
    }
    body {
      padding: 8px 8px 10px;
      font-family: var(--font);
      font-size: var(--vscode-font-size, 12px);
      color: var(--fg);
      line-height: 1.45;
      display: flex;
      flex-direction: column;
      min-height: 100%;
      overflow: hidden;
    }
    .layout-top {
      flex: 0 0 auto;
    }
    .card-recent {
      flex: 0 0 auto;
      margin-bottom: 0;
    }
    .card-recent.expanded {
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
    .card-recent .card-hd { flex: 0 0 auto; cursor: pointer; user-select: none; }
    .card-recent .hint { flex: 0 0 auto; }
    .card-recent .recent-body {
      display: none;
      flex-direction: column;
      flex: 1 1 auto;
      min-height: 0;
    }
    .card-recent.expanded .recent-body { display: flex; }

    /* 折叠箭头 */
    .collapse-icon {
      width: 14px; height: 14px;
      color: var(--fg-muted);
      transition: transform .18s ease;
      flex: 0 0 auto;
    }
    .card-recent.expanded .collapse-icon { transform: rotate(90deg); }

    .hero {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
      padding: 2px 0 10px;
      border-bottom: 1px solid var(--border);
    }
    .logo {
      width: 28px; height: 28px;
      border-radius: var(--r-sm);
      display: grid; place-items: center;
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      color: var(--fg);
      flex: 0 0 auto;
    }
    .logo svg { width: 16px; height: 16px; display: block; }
    .hero-text { min-width: 0; flex: 1; }
    .hero-title {
      font-size: 13px; font-weight: 600; margin: 0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .hero-sub { margin: 2px 0 0; color: var(--fg-muted); font-size: 11px; }
    .status-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--fg-muted); border: 1px solid var(--border); flex: 0 0 auto;
    }
    .status-dot.ok { background: var(--ok-fg); border-color: var(--ok-fg); }
    .status-dot.busy { background: var(--warn-fg); border-color: var(--warn-fg); animation: pulse 1.1s ease-in-out infinite; }
    .status-dot.err { background: var(--err-fg); border-color: var(--err-fg); }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.45} }

    .card {
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: var(--r);
      padding: 8px;
      margin-bottom: 6px;
    }
    .card-hd {
      display: flex; align-items: center; justify-content: space-between;
      gap: 8px; margin-bottom: 8px;
    }
    .card-title {
      font-size: 11px; font-weight: 600; margin: 0;
      color: var(--fg-muted); letter-spacing: 0.02em;
    }

    .path-box {
      display: flex; align-items: flex-start; gap: 8px;
      padding: 8px 10px; border-radius: var(--r-sm);
      background: var(--bg); border: 1px solid var(--border); margin-bottom: 8px;
    }
    .path-icon {
      width: 18px; height: 18px; border-radius: var(--r-sm);
      display: grid; place-items: center; flex: 0 0 auto; margin-top: 1px;
      color: var(--fg-muted); border: 1px solid var(--border);
    }
    .path-icon svg { width: 12px; height: 12px; display: block; }
    .path-icon.valid { color: var(--ok-fg); border-color: var(--ok-fg); background: var(--ok-bg); }
    .path-icon.invalid { color: var(--err-fg); border-color: var(--err-fg); background: var(--err-bg); }
    .path-text {
      min-width: 0; flex: 1; font-family: var(--font-mono);
      font-size: 11px; word-break: break-all; color: var(--fg);
    }
    .path-text.placeholder { color: var(--fg-muted); font-family: var(--font); }

    /* 工程关键信息：两列直观展示，替代一堆杂乱 tag */
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }
    .info-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      padding: 6px 8px;
      border-radius: var(--r-sm);
      background: var(--bg);
      border: 1px solid var(--border);
    }
    .info-item.wide { grid-column: 1 / -1; }
    .info-label {
      font-size: 10px;
      color: var(--fg-muted);
      letter-spacing: 0.02em;
    }
    .info-value {
      font-size: 11.5px;
      font-weight: 600;
      color: var(--fg);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .info-value.ok { color: var(--ok-fg); }
    .info-value.warn { color: var(--warn-fg); }
    .info-value.err { color: var(--err-fg); }
    .info-value.mono {
      font-family: var(--font-mono);
      font-weight: 500;
      font-size: 11px;
    }
    .info-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 2px;
    }
    .meta { display: none; }
    .pill {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 1px 7px; border-radius: 999px; font-size: 10px;
      background: var(--badge-bg); color: var(--badge-fg);
      max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .pill strong { font-weight: 600; }
    .pill.ok { color: var(--ok-fg); background: var(--ok-bg); }
    .pill.err { color: var(--err-fg); background: var(--err-bg); }

    .row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .row + .row { margin-top: 8px; }
    .grow { flex: 1 1 auto; min-width: 0; }

    button {
      font: inherit; border-radius: var(--r-sm);
      border: 1px solid transparent; padding: 6px 11px; cursor: pointer;
      background: var(--btn-bg); color: var(--btn-fg); font-weight: 560;
      transition: background .12s ease, opacity .12s ease, border-color .12s ease;
    }
    button:hover { background: var(--btn-hover); }
    button:focus-visible { outline: 1px solid var(--focus); outline-offset: 1px; }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
    button.ghost {
      background: transparent; color: var(--fg); border-color: var(--border); font-weight: 500;
    }
    button.ghost:hover { background: var(--bg-hover); }
    button.soft {
      background: var(--btn2-bg); color: var(--btn2-fg); font-weight: 500;
    }
    button.soft:hover { background: var(--btn2-hover); }
    button.danger {
      background: transparent; color: var(--err-fg); border-color: var(--err-bd, var(--border)); font-weight: 500;
    }
    button.danger:hover { background: var(--err-bg); }

    /* ── Icon toolbar ── */
    .toolbar {
      position: sticky;
      top: 0;
      z-index: 2;
      background: var(--bg);
      padding: 0 0 8px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 6px;
    }
    .icon-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }
    .icon-bar-top {
      gap: 6px;
      justify-content: flex-start;
    }
    .icon-btn {
      width: 32px; height: 32px;
      padding: 0;
      display: inline-grid;
      place-items: center;
      background: var(--bg);
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: var(--r-sm);
    }
    .icon-bar-top .icon-btn {
      width: 34px; height: 34px;
    }
    .icon-btn svg { width: 15px; height: 15px; display: block; }
    .icon-btn:hover { background: var(--bg-hover); }
    .icon-btn.primary {
      background: var(--btn-bg);
      color: var(--btn-fg);
      border-color: transparent;
      width: 40px;
    }
    .icon-bar-top .icon-btn.primary { width: 40px; }
    .icon-btn.primary:hover { background: var(--btn-hover); }
    .icon-btn.danger {
      color: var(--err-fg);
      border-color: var(--err-bd, var(--border));
      background: transparent;
    }
    .icon-btn.danger:hover { background: var(--err-bg); }
    .icon-btn:disabled { opacity: 0.4; }
    .icon-sep {
      width: 1px; height: 20px;
      background: var(--border);
      margin: 0 2px;
      flex: 0 0 auto;
    }

    /* ── Recent list ── */
    .recent-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
      flex: 1 1 auto;
      min-height: 120px;
      overflow: auto;
      margin: 0 -4px;
      padding: 0 4px 2px;
    }
    .recent-empty {
      color: var(--fg-muted); font-size: 11px; padding: 8px 2px;
    }
    .recent-item {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 6px;
      align-items: center;
      padding: 7px 8px;
      border: 1px solid transparent;
      border-radius: var(--r-sm);
      background: transparent;
      cursor: pointer;
      text-align: left;
      width: 100%;
      color: var(--fg);
      font-weight: 500;
    }
    .recent-item:hover { background: var(--bg-hover); }
    .recent-item.active {
      background: var(--bg-hover);
      border-color: var(--border);
    }
    .recent-item.missing { opacity: 0.55; }
    .recent-main { min-width: 0; }
    .recent-name {
      font-size: 12px; font-weight: 600;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .recent-path {
      font-size: 10.5px; color: var(--fg-muted);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      font-family: var(--font-mono);
    }
    .recent-actions {
      display: flex; gap: 2px;
      opacity: 0;
      transition: opacity .12s ease;
    }
    .recent-item:hover .recent-actions,
    .recent-item:focus-within .recent-actions { opacity: 1; }
    .recent-actions .icon-btn {
      width: 26px; height: 26px;
      background: transparent;
    }
    .recent-actions .icon-btn svg { width: 13px; height: 13px; }

    .hint { margin-top: 6px; color: var(--fg-muted); font-size: 11px; }
    .hint.warn { color: var(--warn-fg); }
    .hint.err { color: var(--err-fg); }
    .hint.ok { color: var(--ok-fg); }

    /* 自定义悬停提示：Webview 中比原生 title 更醒目 */
    .tip {
      position: relative;
    }
    .tip[data-tip]:hover::after {
      content: attr(data-tip);
      position: absolute;
      left: 50%;
      bottom: calc(100% + 8px);
      transform: translateX(-50%);
      background: var(--vscode-editorHoverWidget-background, var(--bg-elevated));
      color: var(--vscode-editorHoverWidget-foreground, var(--fg));
      border: 1px solid var(--vscode-editorHoverWidget-border, var(--border));
      padding: 6px 8px;
      border-radius: 4px;
      font-size: 11px;
      line-height: 1.35;
      white-space: nowrap;
      z-index: 20;
      pointer-events: none;
      box-shadow: 0 4px 12px rgba(0,0,0,.18);
    }
    .tip[data-tip]:hover::before {
      content: '';
      position: absolute;
      left: 50%;
      bottom: calc(100% + 3px);
      transform: translateX(-50%);
      border: 5px solid transparent;
      border-top-color: var(--vscode-editorHoverWidget-border, var(--border));
      z-index: 20;
      pointer-events: none;
    }

    .ready-bar {
      display: flex;
      gap: 6px;
      margin-top: 6px;
    }
    .ready-item {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 8px;
      border-radius: var(--r-sm);
      border: 1px solid var(--border);
      background: var(--bg-elevated);
      min-width: 0;
    }
    .ready-item.ok { border-color: var(--ok-fg); }
    .ready-item.err { border-color: var(--err-fg); }
    .ready-item.warn { border-color: var(--warn-fg); }
    .ready-k {
      font-size: 10px;
      color: var(--fg-muted);
      white-space: nowrap;
      flex: 0 0 auto;
    }
    .ready-v {
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
      min-width: 0;
    }
    .ready-item.ok .ready-v { color: var(--ok-fg); }
    .ready-item.err .ready-v { color: var(--err-fg); }
    .ready-item.warn .ready-v { color: var(--warn-fg); }

    .detect-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 8px;
      border-radius: var(--r-sm);
      border: 1px solid var(--border);
      background: var(--bg);
      margin-bottom: 8px;
      font-size: 11.5px;
    }
    .detect-banner.ok { border-color: var(--ok-fg); color: var(--ok-fg); }
    .detect-banner.warn { border-color: var(--warn-fg); color: var(--warn-fg); }
    .detect-banner.err { border-color: var(--err-fg); color: var(--err-fg); }
    .detect-banner .db-title { font-weight: 700; }
    .detect-banner .db-sub { color: var(--fg-muted); font-weight: 500; }

    .project-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      border-radius: var(--r-sm);
      background: var(--bg);
      border: 1px solid var(--border);
      margin-bottom: 6px;
      min-width: 0;
    }
    .project-row .proj-badge {
      flex: 0 0 auto;
      font-size: 10px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 3px;
      white-space: nowrap;
    }
    .project-row .proj-badge.ok { color: var(--ok-fg); background: var(--ok-bg); border: 1px solid var(--ok-fg); }
    .project-row .proj-badge.warn { color: var(--warn-fg); background: var(--warn-bg); border: 1px solid var(--warn-fg); }
    .project-row .proj-badge.err { color: var(--err-fg); background: var(--err-bg); border: 1px solid var(--err-bd); }
    .project-row .proj-path {
      flex: 1;
      min-width: 0;
      font-family: var(--font-mono);
      font-size: 10.5px;
      color: var(--fg-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .project-row .proj-path.placeholder { color: var(--fg-muted); font-family: var(--font); font-size: 11px; }
    .seg {
      display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 3px;
      padding: 3px; border-radius: 8px;
      background: var(--bg); border: 1px solid var(--border);
    }
    .seg button {
      background: transparent; color: var(--fg-muted); border: none;
      padding: 6px 4px; border-radius: 6px; font-weight: 560; font-size: 11.5px;
    }
    .seg button:hover { background: var(--bg-hover); color: var(--fg); }
    .seg button.active { background: var(--btn-bg); color: var(--btn-fg); }
    .seg button:disabled { opacity: 0.35; }
    .opts { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-top: 8px; }
    label.opt {
      display: inline-flex; align-items: center; gap: 6px;
      color: var(--fg-muted); cursor: pointer; user-select: none; font-size: 11.5px;
    }
    label.opt input { accent-color: var(--btn-bg); margin: 0; }

    /* ── Mode tab bar ── */
    .mode-bar {
      display: flex;
      align-items: center;
      gap: 3px;
      padding: 3px;
      border-radius: 7px;
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      margin-bottom: 6px;
    }
    .mode-bar-btns {
      display: flex;
      flex: 1;
      gap: 3px;
    }
    .mode-btn {
      flex: 1 1 0;
      background: transparent;
      color: var(--fg-muted);
      border: none;
      padding: 6px 4px;
      border-radius: 6px;
      font-weight: 560;
      font-size: 11.5px;
      cursor: pointer;
      transition: background .12s, color .12s;
    }
    .mode-btn:hover { background: var(--bg-hover); color: var(--fg); }
    .mode-btn.active { background: var(--btn-bg); color: var(--btn-fg); }
    .mode-btn:disabled { opacity: 0.35; cursor: not-allowed; }

    /* ── ESP32 sub-mode ── */
    .esp32-sub {
      display: none;
    }
    .esp32-sub.visible {
      display: block;
      margin-bottom: 8px;
    }
    .esp32-sub-bar {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr 1fr;
      gap: 3px;
      padding: 3px;
      border-radius: 8px;
      background: var(--bg);
      border: 1px solid var(--border);
    }
    .esp32-sub-bar button {
      background: transparent;
      color: var(--fg-muted);
      border: none;
      padding: 5px 2px;
      border-radius: 6px;
      font-weight: 560;
      font-size: 11px;
      cursor: pointer;
    }
    .esp32-sub-bar button:hover { background: var(--bg-hover); color: var(--fg); }
    .esp32-sub-bar button.active { background: var(--btn2-bg); color: var(--btn2-fg); }
    .esp32-sub-bar button:disabled { opacity: 0.35; cursor: not-allowed; }
    .ext-footer {
      flex: 0 0 auto;
      text-align: center;
      padding: 6px 0 2px;
      color: var(--fg-muted);
      font-size: 10px;
      opacity: 0.6;
      user-select: none;
    }
  </style>
</head>
<body>
  <div class="layout-top">
  <!-- 模式选择器：Keil5 / STM32Cube / ESP32 -->
  <div class="mode-bar" id="modeBar">
    <div class="mode-bar-btns">
      <button class="mode-btn active" data-mode="stm32cube" id="modeStm32cube">STM32Cube</button>
      <button class="mode-btn" data-mode="keil5" id="modeKeil5">Keil5</button>
      <button class="mode-btn" data-mode="esp32" id="modeEsp32">ESP32</button>
    </div>
    <div id="statusDot" class="status-dot" style="margin-right:4px"></div>
  </div>

  <!-- ESP32 子模式（仅 ESP32 模式下显示） -->
  <div class="esp32-sub" id="esp32Sub">
    <div class="esp32-sub-bar" id="esp32SubBar">
      <button data-sub="platformio" class="active">PlatformIO</button>
      <button data-sub="arduino">Arduino</button>
      <button data-sub="idf">ESP-IDF</button>
      <button data-sub="micropython">MicroPython</button>
    </div>
  </div>

  <!-- actions top -->
  <section class="toolbar" id="opsSection">
    <div class="icon-bar icon-bar-top" id="opsBar">
      <button id="btnBuild" class="icon-btn tip" aria-label="Build">
        <svg viewBox="0 0 24 24" fill="none"><path d="M14.5 5.5l4 4-8.2 8.2c-.4.4-1 .4-1.4 0l-2.6-2.6c-.4-.4-.4-1 0-1.4L14.5 5.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M13 7l4 4M5.5 18.5h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>
      </button>
      <button id="btnFlash" class="icon-btn tip" aria-label="Flash">
        <svg viewBox="0 0 24 24" fill="none"><rect x="7" y="7" width="10" height="10" rx="1.2" stroke="currentColor" stroke-width="1.5"/><path d="M10 4.8v2.2M14 4.8v2.2M10 17v2.2M14 17v2.2M4.8 10h2.2M4.8 14h2.2M17 10h2.2M17 14h2.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/><path d="M12 9.2v4.2M10.2 11.8L12 13.6l1.8-1.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"/></svg>
      </button>
      <button id="btnOne" class="icon-btn primary tip" aria-label="Build &amp; Flash">
        <svg viewBox="0 0 24 24" fill="none"><path d="M8 6.2v11.6L17.5 12 8 6.2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M17.8 7.2l-1.4 2.4h1.8L16.4 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"/></svg>
      </button>
      <span class="icon-sep" aria-hidden="true"></span>
      <button id="btnProbe" class="icon-btn tip" aria-label="Check probe">
        <svg viewBox="0 0 24 24" fill="none"><path d="M9 7.5V4.8h6V7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/><rect x="8" y="7.5" width="8" height="5.2" rx="1" stroke="currentColor" stroke-width="1.5"/><path d="M10.2 12.7v3.1c0 2 1.6 3.6 3.6 3.6h.8M13.8 12.7v2.2c0 1.5 1.2 2.7 2.7 2.7h.3" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>
      </button>
      <button id="btnChip" class="icon-btn tip" aria-label="Chip info">
        <svg viewBox="0 0 24 24" fill="none"><rect x="7" y="7" width="10" height="10" rx="1.2" stroke="currentColor" stroke-width="1.5"/><path d="M10 4.5v2.5M14 4.5v2.5M10 17v2.5M14 17v2.5M4.5 10h2.5M4.5 14h2.5M17 10h2.5M17 14h2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/></svg>
      </button>
      <button id="btnGen" class="icon-btn tip" aria-label="Generate Makefile" style="display:none">
        <svg viewBox="0 0 24 24" fill="none"><path d="M6 4.8h8.2L18 8.6V19.2H6V4.8z" stroke="currentColor" stroke-width="1.5"/><path d="M14 4.9V8.7H18M9 12.2h6M9 15.2h4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>
      </button>
      <span class="icon-sep" aria-hidden="true"></span>
      <button id="btnLog" class="icon-btn tip" aria-label="Open log">
        <svg viewBox="0 0 24 24" fill="none"><path d="M6 4.5h9l3 3V19.5H6V4.5z" stroke="currentColor" stroke-width="1.5"/><path d="M9 10.5h6M9 13.5h6M9 16.5h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>
      </button>
      <button id="btnSettings" class="icon-btn tip" aria-label="Settings">
        <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M12 3.8v2M12 18.2v2M3.8 12h2M18.2 12h2M6.1 6.1l1.4 1.4M16.5 16.5l1.4 1.4M17.9 6.1l-1.4 1.4M7.5 16.5l-1.4 1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>
      </button>
      <button id="btnCancel" class="icon-btn danger tip" aria-label="Cancel">
        <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>
      </button>
    </div>
    <div class="ready-bar" id="readyBar">
      <div class="ready-item" id="readyCompiler">
        <div class="ready-k" id="readyCompilerK">编译器</div>
        <div class="ready-v" id="readyCompilerV">检测中…</div>
      </div>
      <div class="ready-item" id="readyDevice">
        <div class="ready-k" id="readyDeviceK">烧录设备</div>
        <div class="ready-v" id="readyDeviceV">检测中…</div>
      </div>
    </div>
    <div class="hint" id="hint">悬停图标查看功能说明。</div>
  </section>

  <section class="card">
    <div class="card-hd">
      <h2 class="card-title" id="cardTitleProject">工程</h2>
      <button id="btnSelect" class="icon-btn tip" aria-label="Select project">
        <svg viewBox="0 0 24 24" fill="none"><path d="M3.5 7.5h6l1.5 2H20.5v9.5a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7.5z" stroke="currentColor" stroke-width="1.5"/><path d="M12 12v5M9.5 14.5H14.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>
      </button>
    </div>
    <div class="project-row" id="projectRow">
      <span class="proj-badge err" id="projBadge">未选择</span>
      <span class="proj-path placeholder" id="projPath">请选择工程目录</span>
    </div>
    <div id="infoGrid" class="info-grid"></div>
  </section>

  <section class="card" id="flashCard">
    <div class="seg" id="methodSeg">
      <button type="button" data-method="pyocd">pyOCD</button>
      <button type="button" data-method="openocd">OpenOCD</button>
      <button type="button" data-method="keil" id="btnKeil">Keil</button>
    </div>
    <div class="opts" id="pyocdOpts">
      <label class="opt"><input type="checkbox" id="autoDetect" /> <span id="labelAutoDetect">自动识别芯片</span></label>
      <label class="opt"><input type="checkbox" id="underReset" /> <span id="labelUnderReset">复位下连接</span></label>
    </div>
  </section>
  </div>

  <section class="card card-recent" id="recentCard">
    <div class="card-hd" id="recentHd">
      <svg class="collapse-icon" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>
      <h2 class="card-title" id="cardTitleRecent">历史工程</h2>
      <span class="pill" id="recentCount">0</span>
    </div>
    <div class="recent-body">
      <div id="recentList" class="recent-list">
        <div class="recent-empty" id="recentEmptyMsg">暂无历史（与 MCU 工具箱共用）</div>
      </div>
      <div class="hint" id="recentHint">点击切换 VS Code 工程 · 与 MCU 工具箱互通</div>
    </div>
  </section>

  <div class="ext-footer">MCU-Assistant v${version}</div>

  <script>
    const vscode = acquireVsCodeApi();
    const $ = (id) => document.getElementById(id);

    /* ── i18n ── */
    const DICT = {
      'zh-cn': {
        statusTitle: '状态',
        cardOps: '操作',
        cardProject: '工程',
        cardFlash: '烧录方式',
        cardRecent: '历史工程',
        tipBuild: '编译工程（Make/Keil）',
        tipFlash: '烧录固件到芯片',
        tipOne: '一键：编译成功后自动烧录',
        tipProbe: '检测编译器与烧录器是否在线',
        tipChip: '读取芯片信息',
        tipGen: '由 CubeMX 生成 Makefile',
        tipLog: '打开编译/烧录日志',
        tipSettings: '打开插件设置',
        tipCancel: '取消当前编译/烧录任务',
        tipSelect: '选择工程目录并切换 VS Code',
        ariaSelect: '选择工程目录',
        ariaOpen: '打开',
        ariaRemove: '移除',
        labelCompiler: '编译器',
        labelDevice: '烧录设备',
        labelAutoDetect: '自动识别芯片',
        labelUnderReset: '复位下连接',
        hintDefault: '悬停图标查看功能说明。',
        recentHint: '点击切换 VS Code 工程 · 与 MCU 工具箱互通',
        recentEmpty: '暂无历史（与 MCU 工具箱共用）',
        recentMissing: ' · 不存在',
        recentTipOpen: '打开并切换 VS Code',
        recentTipRemove: '从历史移除',
        pathPlaceholder: '请选择工程（打开工作区或手动选择）',
        detectTitle: '工程识别',
        detectNone: '未选择工程',
        noWorkspace: '工作区未识别到 Makefile / Keil',
        noOpenWorkspace: '未打开工作区',
        projectKeil: 'Keil 工程',
        projectMake: 'Makefile 工程',
        projectMixed: '混合工程',
        projectMixedSub: '检测到 Keil 与 Makefile，当前编译：',
        projectCubeMx: 'CubeMX 工程',
        projectCubeMxSub: '仅有 .ioc，请先生成 Makefile',
        projectUnknown: '未识别工程',
        projectUnknownSub: '目录内无 Makefile / Keil / .ioc',
        buildKeil: 'Keil UV4',
        buildMake: 'Make / GCC',
        buildNeedMakefile: '需生成 Makefile',
        buildNone: '不可编译',
        sourceWorkspace: '当前工作区',
        sourceSettings: '手动选择',
        toolchainInstalled: '已共用',
        toolchainNone: '未安装',
        labelProjectType: '工程类型',
        labelBuildSystem: '编译方式',
        labelFlashMethod: '烧录方式',
        labelChip: '目标芯片',
        labelSource: '来源',
        labelToolchain: '工具链',
        statusBusy: '进行中',
        statusOk: '最近任务成功',
        statusErrNoDir: '请选择工程',
        statusErrFail: '最近任务失败',
        statusIdle: '空闲',
        hintNoDir: '请选择工程，或从历史工程切换（自动识别 Keil / Makefile / CubeMX）。',
        hintCubeMx: '已识别 CubeMX 工程，请先生成 Makefile。',
        hintBadProject: '未识别为 Keil / Makefile 工程，无法编译烧录。',
        hintReady: '就绪 · 已识别 ',
        hintReadySuffix: ' · 可编译烧录',
        hintBusy: '进行中…',
        hintNoFlash: '烧录设备不在线：',
        hintInsertDebug: '请插入调试器',
        hintNoBuild: '编译器未就绪：',
        checkingDots: '检测中…',
        notChecked: '未检测',
        'esp32.no_platformio_ini': '未找到 platformio.ini，请选择 PlatformIO 工程',
        'esp32.pio_not_found': '未找到 pio 命令，请安装 PlatformIO CLI 或 PlatformIO IDE',
        'esp32.install_pio_ext': '安装 PlatformIO IDE 扩展',
        'esp32.pio_ext_installing': '正在安装 PlatformIO IDE…',
        'esp32.framework.label': 'Framework',
        'esp32.framework.platformio': 'PlatformIO',
        'esp32.framework.arduino': 'Arduino',
        'esp32.framework.espidf': 'ESP-IDF',
        'esp32.framework.micropython': 'MicroPython',
        'esp32.framework_switch_fail': '更新 platformio.ini 失败：{0}'
      },
      'en': {
        statusTitle: 'Status',
        cardOps: 'Actions',
        cardProject: 'Project',
        cardFlash: 'Flash Method',
        cardRecent: 'Recent Projects',
        tipBuild: 'Build project (Make / Keil)',
        tipFlash: 'Flash firmware to chip',
        tipOne: 'Build & Flash: auto-flash after successful build',
        tipProbe: 'Check compiler and probe status',
        tipChip: 'Read chip info',
        tipGen: 'Generate Makefile from CubeMX .ioc',
        tipLog: 'Open build/flash log',
        tipSettings: 'Open extension settings',
        tipCancel: 'Cancel current build/flash task',
        tipSelect: 'Select project directory and switch VS Code',
        ariaSelect: 'Select project',
        ariaOpen: 'Open',
        ariaRemove: 'Remove',
        labelCompiler: 'Compiler',
        labelDevice: 'Flash device',
        labelAutoDetect: 'Auto-detect chip',
        labelUnderReset: 'Connect under reset',
        hintDefault: 'Hover icons to see tooltips.',
        recentHint: 'Click to switch VS Code workspace · shared with MCU Toolbox',
        recentEmpty: 'No recent projects (shared with MCU Toolbox)',
        recentMissing: ' · missing',
        recentTipOpen: 'Open and switch VS Code',
        recentTipRemove: 'Remove from history',
        pathPlaceholder: 'Select a project (open workspace or pick manually)',
        detectTitle: 'Project',
        detectNone: 'No project selected',
        noWorkspace: 'No Makefile / Keil found in workspace',
        noOpenWorkspace: 'No workspace open',
        projectKeil: 'Keil Project',
        projectMake: 'Makefile Project',
        projectMixed: 'Mixed Project',
        projectMixedSub: 'Keil + Makefile detected, current build: ',
        projectCubeMx: 'CubeMX Project',
        projectCubeMxSub: '.ioc only — generate Makefile first',
        projectUnknown: 'Unknown Project',
        projectUnknownSub: 'No Makefile / Keil / .ioc found',
        buildKeil: 'Keil UV4',
        buildMake: 'Make / GCC',
        buildNeedMakefile: 'Generate Makefile first',
        buildNone: 'Cannot build',
        sourceWorkspace: 'Workspace',
        sourceSettings: 'Manual',
        toolchainInstalled: 'Shared',
        toolchainNone: 'Not installed',
        labelProjectType: 'Project type',
        labelBuildSystem: 'Build system',
        labelFlashMethod: 'Flash method',
        labelChip: 'Target chip',
        labelSource: 'Source',
        labelToolchain: 'Toolchain',
        statusBusy: 'in progress',
        statusOk: 'Last task succeeded',
        statusErrNoDir: 'Select a project',
        statusErrFail: 'Last task failed',
        statusIdle: 'Idle',
        hintNoDir: 'Select a project or switch from recent (auto-detects Keil / Makefile / CubeMX).',
        hintCubeMx: 'CubeMX project detected — generate Makefile first.',
        hintBadProject: 'Not a Keil / Makefile project — cannot build or flash.',
        hintReady: 'Ready · detected ',
        hintReadySuffix: ' · build & flash available',
        hintBusy: 'in progress…',
        hintNoFlash: 'Flash device offline: ',
        hintInsertDebug: 'Insert debugger',
        hintNoBuild: 'Compiler not ready: ',
        checkingDots: 'Checking…',
        notChecked: 'Not checked',
        'esp32.no_platformio_ini': 'platformio.ini not found — select a PlatformIO project',
        'esp32.pio_not_found': 'pio command not found — install PlatformIO CLI or PlatformIO IDE',
        'esp32.install_pio_ext': 'Install PlatformIO IDE extension',
        'esp32.pio_ext_installing': 'Installing PlatformIO IDE…',
        'esp32.framework.label': 'Framework',
        'esp32.framework.platformio': 'PlatformIO',
        'esp32.framework.arduino': 'Arduino',
        'esp32.framework.espidf': 'ESP-IDF',
        'esp32.framework.micropython': 'MicroPython',
        'esp32.framework_switch_fail': 'Failed to update platformio.ini: {0}'
      }
    };

    let _locale = 'zh-cn';
    function t(key) {
      const d = DICT[_locale] || DICT['zh-cn'];
      return key in d ? d[key] : (DICT['zh-cn'][key] || key);
    }

    function applyLocale() {
      // card headers
      const setTxt = (id, key) => { const el = $(id); if (el) el.textContent = t(key); };
      setTxt('cardTitleProject', 'cardProject');
      setTxt('cardTitleRecent', 'cardRecent');
      setTxt('readyCompilerK', 'labelCompiler');
      setTxt('readyDeviceK', 'labelDevice');
      // checkbox labels
      setTxt('labelAutoDetect', 'labelAutoDetect');
      setTxt('labelUnderReset', 'labelUnderReset');
      // recent hint
      setTxt('recentHint', 'recentHint');
      // status dot title
      const dot = $('statusDot'); if (dot) dot.title = t('statusTitle');
      // button tips + aria-labels
      const tips = {
        btnBuild:    ['tipBuild',    'tipBuild'],
        btnFlash:    ['tipFlash',    'tipFlash'],
        btnOne:      ['tipOne',      'tipOne'],
        btnProbe:    ['tipProbe',    'tipProbe'],
        btnChip:     ['tipChip',     'tipChip'],
        btnGen:      ['tipGen',      'tipGen'],
        btnLog:      ['tipLog',      'tipLog'],
        btnSettings: ['tipSettings', 'tipSettings'],
        btnCancel:   ['tipCancel',   'tipCancel'],
        btnSelect:   ['tipSelect',   'ariaSelect']
      };
      Object.entries(tips).forEach(([id, [tipKey, ariaKey]]) => {
        const el = $(id);
        if (!el) return;
        const tip = t(tipKey);
        el.setAttribute('data-tip', tip);
        el.setAttribute('title', tip);
        el.setAttribute('aria-label', t(ariaKey));
      });
    }
    function post(type, extra) {
      vscode.postMessage(Object.assign({ type }, extra || {}));
    }

    let _pioInstallTriggered = false;
    function installPio() { post('installPlatformIO'); _pioInstallTriggered = true; }

    const ICONS = {
      folder: '<svg viewBox="0 0 24 24" fill="none"><path d="M3.5 7.5h6l1.5 2H20.5v9.5a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7.5z" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 10.5h17" stroke="currentColor" stroke-width="1.5"/></svg>',
      ok: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="square"/></svg>',
      warn: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 4.5L21 19.5H3L12 4.5z" stroke="currentColor" stroke-width="1.5"/><path d="M12 10v4.5M12 17.2v.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>',
      open: '<svg viewBox="0 0 24 24" fill="none"><path d="M10 5.5H5.5V18.5H18.5V14" stroke="currentColor" stroke-width="1.5"/><path d="M12.5 5.5H18.5V11.5M18 6l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>',
      trash: '<svg viewBox="0 0 24 24" fill="none"><path d="M6 8h12M9.5 8V6.5h5V8M8.5 8l.7 11h5.6l.7-11" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>'
    };

    $('btnSelect').onclick = () => post('selectProject');

    // 历史工程折叠（默认折叠）
    const recentCard = $('recentCard');
    const recentHd   = $('recentHd');
    if (recentCard && recentHd) {
      recentHd.onclick = () => recentCard.classList.toggle('expanded');
    }
    $('btnSettings').onclick = () => post('openSettings');
    $('btnLog').onclick = () => post('openOutput');
    $('btnProbe').onclick = () => post('checkProbe');
    $('btnChip').onclick = () => post('readChipInfo');
    $('btnGen').onclick = () => post('generateMakefile');
    $('btnBuild').onclick = () => post('build');
    $('btnFlash').onclick = () => post('flash');
    $('btnOne').onclick = () => post('buildAndFlash');
    $('btnCancel').onclick = () => post('cancel');
    $('autoDetect').onchange = (e) => post('setAutoDetect', { value: e.target.checked });
    $('underReset').onchange = (e) => post('setUnderReset', { value: e.target.checked });

    // 模式切换
    document.querySelectorAll('#modeBar .mode-btn').forEach((btn) => {
      btn.onclick = () => {
        if (!btn.disabled) post('setProjectMode', { value: btn.dataset.mode });
      };
    });

    // ESP32 子模式切换（暂只有 platformio 可点）
    document.querySelectorAll('#esp32SubBar button').forEach((btn) => {
      btn.onclick = () => {
        if (!btn.disabled) post('setEsp32SubMode', { value: btn.dataset.sub });
      };
    });
    document.querySelectorAll('#methodSeg button').forEach((btn) => {
      btn.onclick = () => { if (!btn.disabled) post('setFlashMethod', { value: btn.dataset.method }); };
    });

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
    function pill(label, value, cls) {
      if (value == null || value === '') return '';
      return '<span class="pill' + (cls ? ' ' + cls : '') + '">' + escapeHtml(label) + '<strong>' + escapeHtml(String(value)) + '</strong></span>';
    }
    function pillText(text, cls) {
      return '<span class="pill' + (cls ? ' ' + cls : '') + '">' + escapeHtml(text) + '</span>';
    }
    function setMethod(method, isWindows, projectMode) {
      const isKeil5 = projectMode === 'keil5';
      const isEsp32Mode = projectMode === 'esp32';
      document.querySelectorAll('#methodSeg button').forEach((btn) => {
        const m = btn.dataset.method;
        // STM32Cube 模式：隐藏 Keil 按钮
        if (m === 'keil') {
          btn.style.display = isKeil5 ? '' : 'none';
          btn.disabled = !isWindows || !isKeil5;
        } else {
          btn.style.display = isEsp32Mode ? 'none' : '';
          btn.disabled = false;
        }
        btn.classList.toggle('active', m === method);
      });
      $('pyocdOpts').style.display = (method === 'pyocd' && !isEsp32Mode) ? 'flex' : 'none';
    }

    function renderRecent(list, currentDir) {
      const box = $('recentList');
      const items = Array.isArray(list) ? list : [];
      $('recentCount').textContent = String(items.length);
      if (!items.length) {
        box.innerHTML = '<div class="recent-empty">' + escapeHtml(t('recentEmpty')) + '</div>';
        return;
      }
      const cur = currentDir ? String(currentDir) : '';
      box.innerHTML = items.map((r) => {
        const active = cur && r.dir === cur ? ' active' : '';
        const missing = r.exists ? '' : ' missing';
        return (
          '<div class="recent-item' + active + missing + '" data-dir="' + escapeHtml(r.dir) + '">' +
            '<div class="recent-main">' +
              '<div class="recent-name">' + escapeHtml(r.name || r.dir) + (r.exists ? '' : escapeHtml(t('recentMissing'))) + '</div>' +
              '<div class="recent-path" title="' + escapeHtml(r.dir) + '">' + escapeHtml(r.dir) + '</div>' +
            '</div>' +
            '<div class="recent-actions">' +
              '<button class="icon-btn" data-act="open" title="' + escapeHtml(t('recentTipOpen')) + '" aria-label="' + escapeHtml(t('ariaOpen')) + '">' + ICONS.open + '</button>' +
              '<button class="icon-btn danger" data-act="remove" title="' + escapeHtml(t('recentTipRemove')) + '" aria-label="' + escapeHtml(t('ariaRemove')) + '">' + ICONS.trash + '</button>' +
            '</div>' +
          '</div>'
        );
      }).join('');

      box.querySelectorAll('.recent-item').forEach((el) => {
        const dir = el.getAttribute('data-dir');
        el.addEventListener('click', (ev) => {
          const btn = ev.target.closest('button[data-act]');
          if (btn) {
            ev.stopPropagation();
            const act = btn.getAttribute('data-act');
            if (act === 'remove') post('removeRecent', { dir });
            else post('openRecent', { dir });
            return;
          }
          post('openRecent', { dir });
        });
      });
    }

    function infoCell(label, value, opts) {
      const o = opts || {};
      const cls = 'info-item' + (o.wide ? ' wide' : '');
      const vcls = 'info-value'
        + (o.ok ? ' ok' : '')
        + (o.warn ? ' warn' : '')
        + (o.err ? ' err' : '')
        + (o.mono ? ' mono' : '');
      const val = (value == null || value === '') ? '—' : String(value);
      return (
        '<div class="' + cls + '">' +
          '<div class="info-label">' + escapeHtml(label) + '</div>' +
          '<div class="' + vcls + '" title="' + escapeHtml(val) + '">' + escapeHtml(val) + '</div>' +
        '</div>'
      );
    }

    function renderProjectInfo(state, p, cfg, method) {
      const hasDir = !!p.dir;
      const badge  = $('projBadge');
      const projPathEl = $('projPath');
      if (!hasDir) {
        if (badge) { badge.className = 'proj-badge err'; badge.textContent = t('detectNone'); }
        if (projPathEl) { projPathEl.className = 'proj-path placeholder'; projPathEl.textContent = t('pathPlaceholder'); }
        $('infoGrid').innerHTML = infoCell(
          t('labelProjectType'),
          state.hasWorkspace ? t('noWorkspace') : t('noOpenWorkspace'),
          { wide: true, err: true }
        );
        return;
      }

      const kind = p.projectKind || 'unknown';
      const kindLabel = p.projectKindLabel || t('projectUnknown');
      if (kind === 'keil') {
        if (badge) { badge.className = 'proj-badge ok'; badge.textContent = t('projectKeil'); }
      } else if (kind === 'makefile') {
        if (badge) { badge.className = 'proj-badge ok'; badge.textContent = t('projectMake'); }
      } else if (kind === 'makefile+keil') {
        if (badge) { badge.className = 'proj-badge ok'; badge.textContent = t('projectMixed'); }
      } else if (kind === 'cubemx') {
        if (badge) { badge.className = 'proj-badge warn'; badge.textContent = t('projectCubeMx'); }
      } else {
        if (badge) { badge.className = 'proj-badge err'; badge.textContent = t('projectUnknown'); }
      }
      if (projPathEl) {
        projPathEl.textContent = p.dir || '';
        projPathEl.className = 'proj-path';
        projPathEl.title = p.dir || '';
      }

      const build = p.projectValid
        ? (p.buildSystem === 'keil' ? t('buildKeil') : t('buildMake'))
        : (kind === 'cubemx' ? t('buildNeedMakefile') : t('buildNone'));
      const source = p.source === 'workspace' ? t('sourceWorkspace')
        : p.source === 'settings' ? t('sourceSettings') : '—';
      const toolchain = state.hasToolchain ? t('toolchainInstalled') : t('toolchainNone');
      const flashLabel = method === 'openocd' ? 'OpenOCD' : method === 'keil' ? 'Keil UV4' : 'pyOCD';

      // Keil5 模式：用 readiness 数据展示版本和路径
      const projectMode = (state.cfg || {}).projectMode || 'stm32cube';
      if (projectMode === 'keil5') {
        const r = state.readiness;
        const c = (r && r.compiler) || {};
        const f = (r && r.flasher) || {};
        const keilVersion  = c.version    || '';
        const keilInstDir  = c.installDir || '';
        const keilPath     = c.path       || (state.cfg || {}).keilUV4Path || '—';
        const keilDetail   = c.detail     || 'UV4.exe';
        const keilOk       = !!c.ok;
        const deviceDetail = f.detail     || '—';
        const deviceOk     = !!(f.ok && f.online);

        $('infoGrid').innerHTML = [
          infoCell('Keil MDK', keilDetail, { ok: keilOk, err: !keilOk, wide: !keilVersion }),
          keilVersion ? infoCell('Version', keilVersion, { ok: keilOk, mono: true }) : '',
          infoCell('UV4.exe', keilPath, { mono: true, wide: !keilInstDir }),
          keilInstDir ? infoCell('Install Dir', keilInstDir, { mono: true }) : '',
          infoCell(t('labelProjectType'), kindLabel, { ok: p.projectValid, err: !p.projectValid }),
          infoCell(t('labelChip'), (state.cfg || {}).targetChip || '—', { mono: true }),
          infoCell('Flash device', deviceDetail, { ok: deviceOk, err: !deviceOk }),
          infoCell(t('labelSource'), source, { ok: p.source === 'workspace' })
        ].filter(Boolean).join('');
        return;
      }

      $('infoGrid').innerHTML = [
        infoCell(t('labelProjectType'), kindLabel, { ok: p.projectValid, warn: kind === 'cubemx', err: !p.projectValid && kind !== 'cubemx' }),
        infoCell(t('labelBuildSystem'), build, { ok: p.projectValid, warn: kind === 'cubemx', err: !p.projectValid && kind !== 'cubemx' }),
        // Flash method 已在下方 Flash Method 卡片中显示，info grid 不重复
        infoCell(t('labelChip'), cfg.targetChip || '—', { mono: true }),
        infoCell(t('labelSource'), source, { ok: p.source === 'workspace' }),
        infoCell(t('labelToolchain'), toolchain, { ok: !!state.hasToolchain, err: !state.hasToolchain })
      ].join('');

      // ESP32 模式：展示 framework 标签和详细配置
      if (projectMode === 'esp32') {
        const fw = (p.pioFramework || '').toLowerCase();
        const fwLabel = fw === 'arduino' ? t('esp32.framework.arduino')
          : fw === 'espidf' ? t('esp32.framework.espidf')
          : fw === 'micropython' ? t('esp32.framework.micropython')
          : fw ? fw : t('esp32.framework.platformio');

        const pioCfg = p.pioConfig || {};
        const cells = [
          infoCell(t('esp32.framework.label'), fwLabel, { ok: p.projectValid })
        ];

        if (pioCfg.board) cells.push(infoCell('Board', pioCfg.board, { mono: true }));
        if (pioCfg.platform) cells.push(infoCell('Platform', pioCfg.platform, { mono: true }));
        if (pioCfg.uploadSpeed) cells.push(infoCell('Upload Speed', pioCfg.uploadSpeed, { mono: true }));
        if (pioCfg.monitorSpeed) cells.push(infoCell('Monitor Speed', pioCfg.monitorSpeed, { mono: true }));

        $('infoGrid').innerHTML = cells.join('') + $('infoGrid').innerHTML;
      }
    }

    function renderReadiness(state) {
      const r = state.readiness;
      const cEl = $('readyCompiler');
      const dEl = $('readyDevice');
      if (!cEl || !dEl) return;
      const cV = $('readyCompilerV') || cEl.querySelector('.ready-v');
      const dV = $('readyDeviceV')   || dEl.querySelector('.ready-v');
      if (state.checking && !r) {
        cEl.className = 'ready-item warn';
        if (cV) cV.textContent = t('checkingDots');
        dEl.className = 'ready-item warn';
        if (dV) dV.textContent = t('checkingDots');
        return;
      }
      if (!r) {
        cEl.className = 'ready-item';
        if (cV) cV.textContent = t('notChecked');
        dEl.className = 'ready-item';
        if (dV) dV.textContent = t('notChecked');
        return;
      }
      const c = r.compiler || {};
      const f = r.flasher || {};
      cEl.className = 'ready-item ' + (c.ok ? 'ok' : 'err');
      if (cV) cV.textContent = c.ok
        ? ((c.label || t('labelCompiler')) + ' · ' + (c.detail || 'OK'))
        : (c.detail || 'N/A');
      cEl.title = c.path || c.detail || '';

      const online = !!(f.online || (f.mode === 'keil' && f.ok));
      dEl.className = 'ready-item ' + (online ? 'ok' : (f.ok ? 'warn' : 'err'));
      if (dV) dV.textContent = f.detail || (online ? 'Online' : 'Offline');
      dEl.title = f.path || f.detail || '';
    }

    function render(state) {
      if (!state) return;
      const p = state.project || {};
      const cfg = state.cfg || {};
      const busy = !!state.busy;
      const hasDir = !!p.dir;
      const projectMode = cfg.projectMode || 'stm32cube';
      const esp32SubMode = cfg.esp32SubMode || 'platformio';
      const isEsp32 = projectMode === 'esp32';
      const canOps = !!(p.projectValid && hasDir && !busy);
      const method = cfg.flashMethod || 'pyocd';
      const readiness = state.readiness;

      // ── 模式 tab 高亮 ──
      document.querySelectorAll('#modeBar .mode-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.mode === projectMode);
        btn.disabled = busy;
      });

      // ── ESP32 子模式显隐 & 高亮 ──
      const esp32SubEl = $('esp32Sub');
      if (esp32SubEl) esp32SubEl.classList.toggle('visible', isEsp32);
      document.querySelectorAll('#esp32SubBar button').forEach((btn) => {
        if (!btn.disabled) btn.classList.toggle('active', btn.dataset.sub === esp32SubMode);
      });

      // ── 烧录方式 card（ESP32 模式下隐藏）──
      const flashCard = $('flashCard');
      if (flashCard) flashCard.style.display = (isEsp32 || projectMode === 'keil5') ? 'none' : '';

      // ── 按钮联动（按模式控制显隐）──
      // ESP32: 隐藏探针检测、读芯片、生成Makefile；显示编译/烧录
      const showProbe = !isEsp32;
      const showChip  = !isEsp32;
      const showGen   = !isEsp32 && (p.hasIoc && !p.hasMakefile);
      if ($('btnProbe')) $('btnProbe').style.display = showProbe ? '' : 'none';
      if ($('btnChip'))  $('btnChip').style.display  = showChip  ? '' : 'none';
      if ($('btnGen'))   $('btnGen').style.display   = showGen   ? 'inline-grid' : 'none';

      let kind = '';
      if (!hasDir && !busy) kind = 'err';
      else if (busy) kind = 'busy';
      else if (state.lastResult === 'ok') kind = 'ok';
      else if (state.lastResult === 'err') kind = 'err';
      $('statusDot').className = 'status-dot' + (kind ? ' ' + kind : '');
      $('statusDot').title =
        kind === 'busy' ? ((state.job || '') + ' ' + t('statusBusy')) :
        kind === 'ok'   ? t('statusOk') :
        kind === 'err'  ? (!hasDir ? t('statusErrNoDir') : t('statusErrFail')) : t('statusIdle');

      const pathEl = $('projPath');
      if (pathEl) {
        if (!hasDir) {
          pathEl.textContent = t('pathPlaceholder');
          pathEl.className = 'proj-path placeholder';
        } else {
          pathEl.textContent = p.dir;
          pathEl.className = 'proj-path';
        }
      }

      renderProjectInfo(state, p, cfg, method);
      renderReadiness(state);

      setMethod(method, !!state.isWindows, projectMode);
      $('autoDetect').checked = cfg.autoDetectChip !== false;
      $('underReset').checked = !!cfg.connectUnderReset;

      const buildReady = !!(readiness && readiness.readyForBuild);
      const flashReady = !!(readiness && readiness.readyForFlash);
      const isChecking = !!state.checking;

      // 各模式工程匹配条件（必须同时满足才能操作）
      let projectMatchesMode = false;
      if (projectMode === 'stm32cube') {
        // STM32Cube 需要 Makefile 工程
        projectMatchesMode = !!(hasDir && p.hasMakefile);
      } else if (projectMode === 'keil5') {
        // Keil5 需要 .uvprojx 工程
        projectMatchesMode = !!(hasDir && p.hasKeil);
      }

      // STM32Cube / Keil5 有效操作条件：工程匹配 + readiness 已就绪 + 不繁忙
      const effectiveCanOps = isEsp32
        ? (!busy && (buildReady || isChecking === false))
        : !!(projectMatchesMode && !busy);

      $('btnBuild').disabled = isChecking || !effectiveCanOps || !buildReady;
      $('btnFlash').disabled = isChecking || !effectiveCanOps || !flashReady;
      $('btnOne').disabled   = isChecking || !effectiveCanOps || !(buildReady && flashReady);
      ['btnSelect'].forEach((id) => { $(id).disabled = busy; });
      if ($('btnProbe')) $('btnProbe').disabled = busy;
      if ($('btnChip'))  $('btnChip').disabled  = busy;
      $('btnCancel').disabled = !busy;
      document.querySelectorAll('#methodSeg button').forEach((btn) => {
        if (btn.dataset.method !== 'keil') btn.disabled = busy;
        else btn.disabled = busy || !state.isWindows;
      });
      $('autoDetect').disabled = busy;
      $('underReset').disabled = busy;

      renderRecent(state.recent || [], p.dir || '');

      const hint = $('hint');
      if (isEsp32) {
        // 切换模式或扩展已安装时重置自动安装标志
        if (state.hasPioExtension || esp32SubMode !== 'platformio') {
          _pioInstallTriggered = false;
        }
        if (!hasDir) {
          hint.className = 'hint err';
          hint.innerHTML = escapeHtml(t('hintNoDir'));
        } else if (!p.hasPlatformIO && esp32SubMode === 'platformio') {
          hint.className = 'hint warn';
          hint.innerHTML = escapeHtml(t('esp32.no_platformio_ini'));
        } else if (busy) {
          hint.className = 'hint warn';
          hint.innerHTML = escapeHtml((state.job || '') + ' ' + t('hintBusy'));
        } else if (readiness && !readiness.readyForBuild) {
          // pio 未找到：区分安装状态
          if (_pioInstallTriggered && !state.hasPioExtension) {
            hint.className = 'hint warn';
            hint.innerHTML = escapeHtml(t('esp32.pio_ext_installing'));
          } else if (!state.hasPioExtension) {
            // 有 PlatformIO 工程时自动安装 IDE 扩展（仅触发一次）
            if (p.hasPlatformIO && !_pioInstallTriggered) {
              installPio();
            }
            hint.className = 'hint err';
            hint.innerHTML =
              escapeHtml(t('esp32.pio_not_found')) +
              ' <button onclick="installPio()" style="' +
              'margin-left:6px;padding:2px 8px;font-size:10.5px;' +
              'border-radius:3px;border:1px solid var(--btn-bg);' +
              'background:var(--btn-bg);color:var(--btn-fg);cursor:pointer">' +
              escapeHtml(t('esp32.install_pio_ext')) + '</button>';
          } else if (state.hasPioExtension && readiness.flasher && !readiness.flasher.online) {
            // 扩展已安装但未激活（刚安装未 reload）
            hint.className = 'hint warn';
            hint.innerHTML =
              escapeHtml(t('esp32.pio_need_reload')) +
              '<br><small style="color:var(--fg-muted)">' +
              escapeHtml(t('esp32.pio_restart_hint')) + '</small>';
          } else {
            hint.className = 'hint err';
            hint.innerHTML = escapeHtml(t('esp32.pio_not_found'));
          }
        } else {
          hint.className = 'hint ok';
          hint.innerHTML = escapeHtml(t('hintReady') + (p.projectKindLabel || 'PlatformIO') + t('hintReadySuffix'));
        }
      } else if (!hasDir) {
        hint.className = 'hint err';
        hint.textContent = t('hintNoDir');
      } else if (!p.projectValid) {
        hint.className = 'hint warn';
        hint.textContent = p.projectKind === 'cubemx' ? t('hintCubeMx') : t('hintBadProject');
      } else if (busy) {
        hint.className = 'hint warn';
        hint.textContent = (state.job || '') + ' ' + t('hintBusy');
      } else if (readiness && !readiness.readyForFlash) {
        hint.className = 'hint err';
        hint.textContent = t('hintNoFlash') + ((readiness.flasher && readiness.flasher.detail) || t('hintInsertDebug'));
      } else if (readiness && !readiness.readyForBuild) {
        hint.className = 'hint err';
        hint.textContent = t('hintNoBuild') + ((readiness.compiler && readiness.compiler.detail) || '');
      } else {
        hint.className = 'hint ok';
        hint.textContent = t('hintReady') + (p.projectKindLabel || '') + t('hintReadySuffix');
      }
    }

    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (msg && msg.type === 'state') {
        try {
          if (msg.state && msg.state.locale) {
            _locale = msg.state.locale;
            applyLocale();
          }
          render(msg.state);
        } catch (err) {
          // 错误边界：渲染异常时显示降级 UI，而非白屏
          const hint = $('hint');
          if (hint) {
            hint.className = 'hint err';
            hint.textContent = '[渲染错误] ' + (err && err.message ? err.message : String(err));
          }
          console.error('[MCU-Assistant] render error:', err);
        }
      }
    });
    post('ready');
  </script>
</body>
</html>`;
  }
}

module.exports = { Stm32FlashViewProvider };
