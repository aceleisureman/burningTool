'use strict';

const vscode = require('vscode');
const { updateSetting } = require('../config');

class Stm32FlashViewProvider {
  static viewType = 'stm32Flash.sidebar';

  /**
   * @param {vscode.Uri} extensionUri
   * @param {*} service
   */
  constructor(extensionUri, service) {
    this._extensionUri = extensionUri;
    this._service = service;
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

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root {
      color-scheme: light dark;
      --r: 6px;
      --r-sm: 4px;
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
      padding: 10px 10px 12px;
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
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      flex-direction: column;
      margin-bottom: 0;
    }
    .card-recent .card-hd { flex: 0 0 auto; }
    .card-recent .hint { flex: 0 0 auto; }

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
      padding: 10px;
      margin-bottom: 8px;
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
    .card-ops-top {
      position: sticky;
      top: 0;
      z-index: 2;
      background: var(--bg-elevated);
      padding: 8px 10px;
    }
    .card-ops-top .card-hd { margin-bottom: 6px; }
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
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      margin-top: 8px;
    }
    .ready-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 6px 8px;
      border-radius: var(--r-sm);
      border: 1px solid var(--border);
      background: var(--bg);
      min-width: 0;
    }
    .ready-item.ok { border-color: var(--ok-fg); }
    .ready-item.err { border-color: var(--err-fg); }
    .ready-item.warn { border-color: var(--warn-fg); }
    .ready-k {
      font-size: 10px;
      color: var(--fg-muted);
    }
    .ready-v {
      font-size: 11.5px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
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
  </style>
</head>
<body>
  <div class="layout-top">
  <header class="hero">
    <div class="logo" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none"><rect x="6" y="6" width="12" height="12" rx="1.5" stroke="currentColor" stroke-width="1.5"/><rect x="9" y="9" width="6" height="6" rx="0.5" fill="currentColor"/><path d="M9 3.5v2.5M12 3.5v2.5M15 3.5v2.5M9 18v2.5M12 18v2.5M15 18v2.5M3.5 9h2.5M3.5 12h2.5M3.5 15h2.5M18 9h2.5M18 12h2.5M18 15h2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>
    </div>
    <div class="hero-text">
      <h1 class="hero-title">MCU-Assistant</h1>
      <p class="hero-sub" id="heroSub">Makefile · pyOCD / OpenOCD</p>
    </div>
    <div id="statusDot" class="status-dot" title="状态"></div>
  </header>

  <!-- 主操作置顶：编译 / 烧录优先可见 -->
  <section class="card card-ops-top">
    <div class="card-hd">
      <h2 class="card-title">操作</h2>
    </div>
    <div class="icon-bar icon-bar-top" id="opsBar">
      <button id="btnBuild" class="icon-btn tip" data-tip="编译工程（Make/Keil）" title="编译工程（Make/Keil）" aria-label="编译">
        <!-- hammer / build -->
        <svg viewBox="0 0 24 24" fill="none"><path d="M14.5 5.5l4 4-8.2 8.2c-.4.4-1 .4-1.4 0l-2.6-2.6c-.4-.4-.4-1 0-1.4L14.5 5.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M13 7l4 4M5.5 18.5h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>
      </button>
      <button id="btnFlash" class="icon-btn tip" data-tip="烧录固件到芯片" title="烧录固件到芯片" aria-label="烧录">
        <!-- chip download -->
        <svg viewBox="0 0 24 24" fill="none"><rect x="7" y="7" width="10" height="10" rx="1.2" stroke="currentColor" stroke-width="1.5"/><path d="M10 4.8v2.2M14 4.8v2.2M10 17v2.2M14 17v2.2M4.8 10h2.2M4.8 14h2.2M17 10h2.2M17 14h2.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/><path d="M12 9.2v4.2M10.2 11.8L12 13.6l1.8-1.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"/></svg>
      </button>
      <button id="btnOne" class="icon-btn primary tip" data-tip="一键：编译成功后自动烧录" title="一键：编译成功后自动烧录" aria-label="一键编译烧录">
        <!-- play + bolt -->
        <svg viewBox="0 0 24 24" fill="none"><path d="M8 6.2v11.6L17.5 12 8 6.2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M17.8 7.2l-1.4 2.4h1.8L16.4 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"/></svg>
      </button>
      <span class="icon-sep" aria-hidden="true"></span>
      <button id="btnProbe" class="icon-btn tip" data-tip="检测编译器与烧录器是否在线" title="检测编译器与烧录器是否在线" aria-label="检测烧录器">
        <!-- usb / link probe -->
        <svg viewBox="0 0 24 24" fill="none"><path d="M9 7.5V4.8h6V7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/><rect x="8" y="7.5" width="8" height="5.2" rx="1" stroke="currentColor" stroke-width="1.5"/><path d="M10.2 12.7v3.1c0 2 1.6 3.6 3.6 3.6h.8M13.8 12.7v2.2c0 1.5 1.2 2.7 2.7 2.7h.3" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>
      </button>
      <button id="btnChip" class="icon-btn tip" data-tip="读取芯片信息" title="读取芯片信息" aria-label="芯片信息">
        <svg viewBox="0 0 24 24" fill="none"><rect x="7" y="7" width="10" height="10" rx="1.2" stroke="currentColor" stroke-width="1.5"/><path d="M10 4.5v2.5M14 4.5v2.5M10 17v2.5M14 17v2.5M4.5 10h2.5M4.5 14h2.5M17 10h2.5M17 14h2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/></svg>
      </button>
      <button id="btnGen" class="icon-btn tip" data-tip="由 CubeMX 生成 Makefile" title="由 CubeMX 生成 Makefile" aria-label="生成 Makefile" style="display:none">
        <svg viewBox="0 0 24 24" fill="none"><path d="M6 4.8h8.2L18 8.6V19.2H6V4.8z" stroke="currentColor" stroke-width="1.5"/><path d="M14 4.9V8.7H18M9 12.2h6M9 15.2h4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>
      </button>
      <span class="icon-sep" aria-hidden="true"></span>
      <button id="btnLog" class="icon-btn tip" data-tip="打开编译/烧录日志" title="打开编译/烧录日志" aria-label="打开日志">
        <svg viewBox="0 0 24 24" fill="none"><path d="M6 4.5h9l3 3V19.5H6V4.5z" stroke="currentColor" stroke-width="1.5"/><path d="M9 10.5h6M9 13.5h6M9 16.5h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>
      </button>
      <button id="btnSettings" class="icon-btn tip" data-tip="打开插件设置" title="打开插件设置" aria-label="打开设置">
        <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M12 3.8v2M12 18.2v2M3.8 12h2M18.2 12h2M6.1 6.1l1.4 1.4M16.5 16.5l1.4 1.4M17.9 6.1l-1.4 1.4M7.5 16.5l-1.4 1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>
      </button>
      <button id="btnCancel" class="icon-btn danger tip" data-tip="取消当前编译/烧录任务" title="取消当前编译/烧录任务" aria-label="取消任务">
        <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>
      </button>
    </div>
    <div class="ready-bar" id="readyBar">
      <div class="ready-item" id="readyCompiler">
        <div class="ready-k">编译器</div>
        <div class="ready-v">检测中…</div>
      </div>
      <div class="ready-item" id="readyDevice">
        <div class="ready-k">烧录设备</div>
        <div class="ready-v">检测中…</div>
      </div>
    </div>
    <div class="hint" id="hint">悬停图标查看功能说明。</div>
  </section>

  <section class="card">
    <div class="card-hd">
      <h2 class="card-title">工程</h2>
      <button id="btnSelect" class="icon-btn tip" data-tip="选择工程目录并切换 VS Code" title="选择工程目录并切换 VS Code" aria-label="选择工程目录">
        <svg viewBox="0 0 24 24" fill="none"><path d="M3.5 7.5h6l1.5 2H20.5v9.5a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7.5z" stroke="currentColor" stroke-width="1.5"/><path d="M12 12v5M9.5 14.5H14.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>
      </button>
    </div>
    <div id="detectBanner" class="detect-banner err">
      <span class="db-title">工程识别</span>
      <span class="db-sub">未选择工程</span>
    </div>
    <div class="path-box">
      <div id="pathIcon" class="path-icon" aria-hidden="true"></div>
      <div id="path" class="path-text placeholder">请选择工程</div>
    </div>
    <div id="infoGrid" class="info-grid"></div>
  </section>

  <section class="card">
    <div class="card-hd"><h2 class="card-title">烧录方式</h2></div>
    <div class="seg" id="methodSeg">
      <button type="button" data-method="pyocd">pyOCD</button>
      <button type="button" data-method="openocd">OpenOCD</button>
      <button type="button" data-method="keil" id="btnKeil">Keil</button>
    </div>
    <div class="opts" id="pyocdOpts">
      <label class="opt"><input type="checkbox" id="autoDetect" /> 自动识别芯片</label>
      <label class="opt"><input type="checkbox" id="underReset" /> 复位下连接</label>
    </div>
  </section>
  </div>

  <section class="card card-recent">
    <div class="card-hd">
      <h2 class="card-title">历史工程</h2>
      <span class="pill" id="recentCount">0</span>
    </div>
    <div id="recentList" class="recent-list">
      <div class="recent-empty">暂无历史（与 MCU 工具箱共用）</div>
    </div>
    <div class="hint">点击切换 VS Code 工程 · 与 MCU 工具箱互通</div>
  </section>

  <script>
    const vscode = acquireVsCodeApi();
    const $ = (id) => document.getElementById(id);
    function post(type, extra) {
      vscode.postMessage(Object.assign({ type }, extra || {}));
    }

    const ICONS = {
      folder: '<svg viewBox="0 0 24 24" fill="none"><path d="M3.5 7.5h6l1.5 2H20.5v9.5a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7.5z" stroke="currentColor" stroke-width="1.5"/><path d="M3.5 10.5h17" stroke="currentColor" stroke-width="1.5"/></svg>',
      ok: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="square"/></svg>',
      warn: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 4.5L21 19.5H3L12 4.5z" stroke="currentColor" stroke-width="1.5"/><path d="M12 10v4.5M12 17.2v.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>',
      open: '<svg viewBox="0 0 24 24" fill="none"><path d="M10 5.5H5.5V18.5H18.5V14" stroke="currentColor" stroke-width="1.5"/><path d="M12.5 5.5H18.5V11.5M18 6l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>',
      trash: '<svg viewBox="0 0 24 24" fill="none"><path d="M6 8h12M9.5 8V6.5h5V8M8.5 8l.7 11h5.6l.7-11" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>'
    };

    $('btnSelect').onclick = () => post('selectProject');
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
    function setMethod(method, isWindows) {
      document.querySelectorAll('#methodSeg button').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.method === method);
        if (btn.dataset.method === 'keil') btn.disabled = !isWindows;
      });
      $('pyocdOpts').style.display = method === 'pyocd' ? 'flex' : 'none';
    }

    function renderRecent(list, currentDir) {
      const box = $('recentList');
      const items = Array.isArray(list) ? list : [];
      $('recentCount').textContent = String(items.length);
      if (!items.length) {
        box.innerHTML = '<div class="recent-empty">暂无历史（与 MCU 工具箱共用）</div>';
        return;
      }
      const cur = currentDir ? String(currentDir) : '';
      box.innerHTML = items.map((r) => {
        const active = cur && r.dir === cur ? ' active' : '';
        const missing = r.exists ? '' : ' missing';
        return (
          '<div class="recent-item' + active + missing + '" data-dir="' + escapeHtml(r.dir) + '">' +
            '<div class="recent-main">' +
              '<div class="recent-name">' + escapeHtml(r.name || r.dir) + (r.exists ? '' : ' · 不存在') + '</div>' +
              '<div class="recent-path" title="' + escapeHtml(r.dir) + '">' + escapeHtml(r.dir) + '</div>' +
            '</div>' +
            '<div class="recent-actions">' +
              '<button class="icon-btn" data-act="open" title="打开并切换 VS Code" aria-label="打开">' + ICONS.open + '</button>' +
              '<button class="icon-btn danger" data-act="remove" title="从历史移除" aria-label="移除">' + ICONS.trash + '</button>' +
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
      const banner = $('detectBanner');
      if (!hasDir) {
        banner.className = 'detect-banner err';
        banner.innerHTML = '<span class="db-title">工程识别</span><span class="db-sub">未选择工程</span>';
        $('infoGrid').innerHTML = infoCell(
          '工程状态',
          state.hasWorkspace ? '工作区未识别到 Makefile / Keil' : '未打开工作区',
          { wide: true, err: true }
        );
        return;
      }

      const kind = p.projectKind || 'unknown';
      const kindLabel = p.projectKindLabel || '未识别工程';
      if (kind === 'keil') {
        banner.className = 'detect-banner ok';
        banner.innerHTML = '<span class="db-title">Keil 工程</span><span class="db-sub">' + escapeHtml(p.keilProject || '.uvprojx') + '</span>';
      } else if (kind === 'makefile') {
        banner.className = 'detect-banner ok';
        banner.innerHTML = '<span class="db-title">Makefile 工程</span><span class="db-sub">GCC / Make 编译</span>';
      } else if (kind === 'makefile+keil') {
        banner.className = 'detect-banner ok';
        banner.innerHTML = '<span class="db-title">混合工程</span><span class="db-sub">检测到 Keil 与 Makefile，当前编译：' + escapeHtml(p.buildSystem === 'keil' ? 'Keil' : 'Make') + '</span>';
      } else if (kind === 'cubemx') {
        banner.className = 'detect-banner warn';
        banner.innerHTML = '<span class="db-title">CubeMX 工程</span><span class="db-sub">仅有 .ioc，请先生成 Makefile</span>';
      } else {
        banner.className = 'detect-banner err';
        banner.innerHTML = '<span class="db-title">未识别工程</span><span class="db-sub">目录内无 Makefile / Keil / .ioc</span>';
      }

      const build = p.projectValid
        ? (p.buildSystem === 'keil' ? 'Keil UV4' : 'Make / GCC')
        : (kind === 'cubemx' ? '需生成 Makefile' : '不可编译');
      const source = p.source === 'workspace' ? '当前工作区'
        : p.source === 'settings' ? '手动选择' : '—';
      const toolchain = state.hasToolchain ? '已共用' : '未安装';
      const flashLabel = method === 'openocd' ? 'OpenOCD' : method === 'keil' ? 'Keil UV4' : 'pyOCD';

      $('infoGrid').innerHTML = [
        infoCell('工程类型', kindLabel, { ok: p.projectValid, warn: kind === 'cubemx', err: !p.projectValid && kind !== 'cubemx' }),
        infoCell('编译方式', build, { ok: p.projectValid, warn: kind === 'cubemx', err: !p.projectValid && kind !== 'cubemx' }),
        infoCell('烧录方式', flashLabel),
        infoCell('目标芯片', cfg.targetChip || '—', { mono: true }),
        infoCell('来源', source, { ok: p.source === 'workspace' }),
        infoCell('工具链', toolchain, { ok: !!state.hasToolchain, err: !state.hasToolchain })
      ].join('');
    }

    function renderReadiness(state) {
      const r = state.readiness;
      const cEl = $('readyCompiler');
      const dEl = $('readyDevice');
      if (!cEl || !dEl) return;
      if (state.checking && !r) {
        cEl.className = 'ready-item warn';
        cEl.querySelector('.ready-v').textContent = '检测中…';
        dEl.className = 'ready-item warn';
        dEl.querySelector('.ready-v').textContent = '检测中…';
        return;
      }
      if (!r) {
        cEl.className = 'ready-item';
        cEl.querySelector('.ready-v').textContent = '未检测';
        dEl.className = 'ready-item';
        dEl.querySelector('.ready-v').textContent = '未检测';
        return;
      }
      const c = r.compiler || {};
      const f = r.flasher || {};
      cEl.className = 'ready-item ' + (c.ok ? 'ok' : 'err');
      cEl.querySelector('.ready-v').textContent = c.ok
        ? ((c.label || '编译器') + ' · ' + (c.detail || '就绪'))
        : (c.detail || '未就绪');
      cEl.title = c.path || c.detail || '';

      const online = !!(f.online || (f.mode === 'keil' && f.ok));
      dEl.className = 'ready-item ' + (online ? 'ok' : (f.ok ? 'warn' : 'err'));
      dEl.querySelector('.ready-v').textContent = online
        ? (f.detail || '设备在线')
        : (f.detail || '设备不在线');
      dEl.title = f.path || f.detail || '';
    }

    function render(state) {
      if (!state) return;
      const p = state.project || {};
      const cfg = state.cfg || {};
      const busy = !!state.busy;
      const hasDir = !!p.dir;
      const canOps = !!(p.projectValid && hasDir && !busy);
      const method = cfg.flashMethod || 'pyocd';
      const readiness = state.readiness;

      let kind = '';
      if (!hasDir && !busy) kind = 'err';
      else if (busy) kind = 'busy';
      else if (state.lastResult === 'ok') kind = 'ok';
      else if (state.lastResult === 'err') kind = 'err';
      $('statusDot').className = 'status-dot' + (kind ? ' ' + kind : '');
      $('statusDot').title =
        kind === 'busy' ? ((state.job || '任务') + ' 进行中') :
        kind === 'ok' ? '最近任务成功' :
        kind === 'err' ? (!hasDir ? '请选择工程' : '最近任务失败') : '空闲';

      const pathEl = $('path');
      const pathIcon = $('pathIcon');
      if (!hasDir) {
        pathEl.textContent = '请选择工程（打开工作区或手动选择）';
        pathEl.className = 'path-text placeholder';
        pathIcon.className = 'path-icon invalid';
        pathIcon.innerHTML = ICONS.warn;
      } else {
        pathEl.textContent = p.dir;
        pathEl.className = 'path-text';
        pathIcon.className = 'path-icon ' + (p.projectValid ? 'valid' : 'invalid');
        pathIcon.innerHTML = p.projectValid ? ICONS.ok : ICONS.warn;
      }

      renderProjectInfo(state, p, cfg, method);
      renderReadiness(state);

      setMethod(method, !!state.isWindows);
      $('autoDetect').checked = cfg.autoDetectChip !== false;
      $('underReset').checked = !!cfg.connectUnderReset;
      $('btnGen').style.display = (p.hasIoc && !p.hasMakefile) ? 'inline-grid' : 'none';
      $('heroSub').textContent = (method === 'openocd' ? 'OpenOCD' : method === 'keil' ? 'Keil UV4' : 'pyOCD')
        + ' · ' + (state.platformId || '');

      const buildReady = !readiness || readiness.readyForBuild;
      const flashReady = !readiness || readiness.readyForFlash;
      $('btnBuild').disabled = !canOps || !buildReady;
      $('btnFlash').disabled = !canOps || !flashReady;
      $('btnOne').disabled = !canOps || !(buildReady && flashReady);
      ['btnProbe','btnChip','btnGen','btnSelect'].forEach((id) => { $(id).disabled = busy; });
      $('btnCancel').disabled = !busy;
      document.querySelectorAll('#methodSeg button').forEach((btn) => {
        if (btn.dataset.method !== 'keil') btn.disabled = busy;
        else btn.disabled = busy || !state.isWindows;
      });
      $('autoDetect').disabled = busy;
      $('underReset').disabled = busy;

      renderRecent(state.recent || [], p.dir || '');

      const hint = $('hint');
      if (!hasDir) {
        hint.className = 'hint err';
        hint.textContent = '请选择工程，或从历史工程切换（自动识别 Keil / Makefile / CubeMX）。';
      } else if (!p.projectValid) {
        hint.className = 'hint warn';
        hint.textContent = p.projectKind === 'cubemx'
          ? '已识别 CubeMX 工程，请先生成 Makefile。'
          : '未识别为 Keil / Makefile 工程，无法编译烧录。';
      } else if (busy) {
        hint.className = 'hint warn';
        hint.textContent = (state.job || '任务') + '进行中…';
      } else if (readiness && !readiness.readyForFlash) {
        hint.className = 'hint err';
        hint.textContent = '烧录设备不在线：' + ((readiness.flasher && readiness.flasher.detail) || '请插入调试器');
      } else if (readiness && !readiness.readyForBuild) {
        hint.className = 'hint err';
        hint.textContent = '编译器未就绪：' + ((readiness.compiler && readiness.compiler.detail) || '');
      } else {
        hint.className = 'hint ok';
        hint.textContent = '就绪 · 已识别 ' + (p.projectKindLabel || '工程') + ' · 可编译烧录';
      }
    }

    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (msg && msg.type === 'state') render(msg.state);
    });
    post('ready');
  </script>
</body>
</html>`;
  }
}

module.exports = { Stm32FlashViewProvider };
