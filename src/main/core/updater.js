// 自动更新：基于 electron-updater + GitHub Releases
// CI 每次构建发布新版本（1.0.<构建号>），应用启动后自动检查、
// 静默下载，下载完成弹窗询问是否立即重启安装。
//
// macOS 注意：
// 1. 自动更新依赖 zip 产物（latest-mac.yml 指向 *-mac.zip / 自定义 artifact），不是 dmg
// 2. 当前 CI 关闭代码签名（identity: null / CSC_IDENTITY_AUTO_DISCOVERY=false）
// 3. Electron 原生 Squirrel.Mac/ShipIt 强制校验代码签名，未签名包必失败：
//    “Code signature ... did not pass validation / 代码对象根本未签名”
//    因此 mac 未签名构建不走 ShipIt，改为自管下载 zip + 退出后脚本替换 .app
// 4. Windows/Linux 仍走 electron-updater 官方路径
const { app, dialog, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const bus = require('./bus');

const OWNER = 'aceleisureman';
const REPO = 'burningTool';

let autoUpdater = null;
let state = { status: 'idle', version: null, percent: 0, error: null, platform: process.platform, mode: null };
let installing = false;
let forceExitTimer = null;
let promptShownForVersion = null;
let lastErrorAt = 0;
// mac 自管更新：已下载的 zip 与解析到的更新信息
let macPending = null; // { version, zipPath, sha512, fileName, url }

function setState(patch) {
  state = Object.assign({}, state, patch);
  broadcastState();
  return state;
}

function getState() {
  return Object.assign({}, state, {
    currentVersion: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged
  });
}

function broadcastState() {
  const snapshot = getState();
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
        win.webContents.send('update-status', snapshot);
      }
    }
  } catch {}
}

function isMac() {
  return process.platform === 'darwin';
}

function isSignatureError(err) {
  const raw = String((err && err.message) || err || '');
  return /code signature|signature|notariz|Gatekeeper|代码对象根本未签名|did not pass validation/i.test(raw);
}

function normalizeUpdateError(err) {
  const raw = String((err && err.message) || err || 'unknown');
  if (isSignatureError(raw)) {
    return raw + '（当前构建未启用 Apple 代码签名；macOS 将改用本地 zip 替换安装，不再走 ShipIt）';
  }
  if (/ENOENT|latest-mac\.yml|Cannot find channel/i.test(raw)) {
    return raw + '（未找到 mac 更新清单 latest-mac.yml，请确认 CI 已发布 zip 产物）';
  }
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|net::|403|429|rate limit/i.test(raw)) {
    return raw + '（网络访问 GitHub 失败，可稍后重试或检查代理）';
  }
  return raw;
}

/* ── 通用：下载 / 请求 ─────────────────────────────────── */
function requestText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 8) return reject(new Error('too many redirects'));
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'MCUToolbox-Updater',
        Accept: 'application/octet-stream, text/yaml, */*'
      },
      timeout: 30000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return resolve(requestText(next, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(new Error('request timeout')); });
    req.on('error', reject);
  });
}

function downloadFile(url, dest, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 8) return reject(new Error('too many redirects'));
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'MCUToolbox-Updater',
        Accept: 'application/octet-stream, */*'
      },
      timeout: 120000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return resolve(downloadFile(next, dest, onProgress, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const total = parseInt(res.headers['content-length'] || '0', 10) || 0;
      let received = 0;
      let lastPct = -1;
      const tmp = dest + '.part';
      const out = fs.createWriteStream(tmp);
      res.on('data', (chunk) => {
        received += chunk.length;
        if (total > 0 && onProgress) {
          const pct = Math.min(100, Math.round((received / total) * 100));
          if (pct !== lastPct) {
            lastPct = pct;
            onProgress(pct, received, total);
          }
        }
      });
      res.pipe(out);
      out.on('finish', () => {
        out.close(() => {
          try {
            fs.renameSync(tmp, dest);
            resolve({ path: dest, size: received });
          } catch (e) {
            reject(e);
          }
        });
      });
      out.on('error', (e) => {
        try { fs.unlinkSync(tmp); } catch {}
        reject(e);
      });
      res.on('error', (e) => {
        try { fs.unlinkSync(tmp); } catch {}
        reject(e);
      });
    });
    req.on('timeout', () => { req.destroy(new Error('download timeout')); });
    req.on('error', reject);
  });
}

function sha512File(filePath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha512');
    const s = fs.createReadStream(filePath);
    s.on('data', (d) => h.update(d));
    s.on('error', reject);
    s.on('end', () => resolve(h.digest('base64')));
  });
}

/* ── 简易 YAML 解析（latest-mac.yml 结构固定）─────────── */
function parseLatestYml(text) {
  const lines = String(text || '').split(/\r?\n/);
  const info = { version: null, path: null, sha512: null, files: [] };
  let inFiles = false;
  let current = null;
  for (const raw of lines) {
    const line = raw.replace(/\t/g, '  ');
    if (/^version:\s*/.test(line)) {
      info.version = line.replace(/^version:\s*/, '').trim().replace(/^['"]|['"]$/g, '');
      inFiles = false;
      continue;
    }
    if (/^path:\s*/.test(line)) {
      info.path = line.replace(/^path:\s*/, '').trim().replace(/^['"]|['"]$/g, '');
      continue;
    }
    if (/^sha512:\s*/.test(line)) {
      info.sha512 = line.replace(/^sha512:\s*/, '').trim().replace(/^['"]|['"]$/g, '');
      continue;
    }
    if (/^files:\s*$/.test(line)) {
      inFiles = true;
      continue;
    }
    if (inFiles) {
      if (/^\s*-\s+url:\s*/.test(line) || /^\s*-\s+path:\s*/.test(line)) {
        current = {};
        info.files.push(current);
        const m = line.match(/^\s*-\s+(url|path):\s*(.+)\s*$/);
        if (m) current[m[1] === 'url' ? 'url' : 'path'] = m[2].trim().replace(/^['"]|['"]$/g, '');
        continue;
      }
      if (current && /^\s+sha512:\s*/.test(line)) {
        current.sha512 = line.replace(/^\s+sha512:\s*/, '').trim().replace(/^['"]|['"]$/g, '');
        continue;
      }
      if (current && /^\s+size:\s*/.test(line)) {
        current.size = Number(line.replace(/^\s+size:\s*/, '').trim()) || 0;
        continue;
      }
      if (current && /^\s+(url|path):\s*/.test(line)) {
        const m = line.match(/^\s+(url|path):\s*(.+)\s*$/);
        if (m) current[m[1] === 'url' ? 'url' : 'path'] = m[2].trim().replace(/^['"]|['"]$/g, '');
        continue;
      }
      if (/^\S/.test(line)) {
        inFiles = false;
        current = null;
      }
    }
  }
  return info;
}

function semverParts(v) {
  const m = String(v || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function isNewerVersion(remote, local) {
  const a = semverParts(remote);
  const b = semverParts(local);
  if (!a || !b) return String(remote) !== String(local) && !!remote;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

function pickMacZipFile(yml) {
  const files = Array.isArray(yml.files) ? yml.files : [];
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const names = files.map((f) => f.url || f.path || '').filter(Boolean);
  // 优先：匹配当前 arch 的 zip → universal → path 字段 → 任意 zip
  const prefer = [
    names.find((n) => /\.zip$/i.test(n) && n.includes(arch)),
    names.find((n) => /\.zip$/i.test(n) && /universal/i.test(n)),
    (yml.path && /\.zip$/i.test(yml.path) ? yml.path : null),
    names.find((n) => /\.zip$/i.test(n))
  ].filter(Boolean);
  const chosen = prefer[0];
  if (!chosen) return null;
  const meta = files.find((f) => (f.url || f.path) === chosen) || {};
  return {
    fileName: chosen,
    sha512: meta.sha512 || yml.sha512 || null,
    url: 'https://github.com/' + OWNER + '/' + REPO + '/releases/download/v' + yml.version + '/' + chosen
  };
}

function macUpdateDir() {
  return path.join(app.getPath('userData'), 'updates');
}

function getCurrentAppBundlePath() {
  // process.execPath = .../MCU工具箱.app/Contents/MacOS/MCU工具箱
  let p = process.execPath;
  // 向上找到 .app
  while (p && p !== path.dirname(p)) {
    if (/\.app$/i.test(p)) return p;
    p = path.dirname(p);
  }
  // 回退：app.getPath('exe') 同理
  try {
    p = app.getPath('exe');
    while (p && p !== path.dirname(p)) {
      if (/\.app$/i.test(p)) return p;
      p = path.dirname(p);
    }
  } catch {}
  return null;
}

function isRunningFromDmg() {
  try {
    return /\/Volumes\//.test(process.execPath || '');
  } catch {
    return false;
  }
}

/* ── macOS 自管更新（绕过 ShipIt）─────────────────────── */
async function macCheckAndDownload() {
  setState({ status: 'checking', error: null, mode: 'mac-manual' });
  const ymlUrl = 'https://github.com/' + OWNER + '/' + REPO + '/releases/latest/download/latest-mac.yml';
  let text;
  try {
    text = await requestText(ymlUrl);
  } catch (e) {
    // 备用：带 v 的 latest 不可用时走 API 拿最新 release 的 latest-mac.yml 地址
    throw new Error('获取 latest-mac.yml 失败: ' + (e && e.message ? e.message : e));
  }
  const yml = parseLatestYml(text);
  if (!yml.version) throw new Error('latest-mac.yml 缺少 version');
  const current = app.getVersion();
  if (!isNewerVersion(yml.version, current)) {
    setState({ status: 'latest', version: yml.version, percent: 0, error: null, mode: 'mac-manual' });
    return { ok: true, update: false, version: yml.version, state: getState() };
  }
  const zip = pickMacZipFile(yml);
  if (!zip) throw new Error('latest-mac.yml 中未找到 zip 更新包');

  setState({ status: 'downloading', version: yml.version, percent: 0, error: null, mode: 'mac-manual' });
  bus.send('发现新版本 v' + yml.version + '，正在后台下载（mac 自管，绕过 ShipIt）…', 'info');

  const dest = path.join(macUpdateDir(), zip.fileName);
  // 若已有同版本文件且 sha 匹配，跳过下载
  let needDownload = true;
  if (fs.existsSync(dest) && zip.sha512) {
    try {
      const got = await sha512File(dest);
      if (got === zip.sha512) needDownload = false;
    } catch {}
  }
  if (needDownload) {
    await downloadFile(zip.url, dest, (pct) => {
      if (state.status === 'downloading' && state.percent === pct) return;
      setState({ status: 'downloading', version: yml.version, percent: pct, mode: 'mac-manual' });
      bus.sendProgress('app-update', '下载更新 v' + yml.version + ': ' + pct + '%');
    });
    if (zip.sha512) {
      const got = await sha512File(dest);
      if (got !== zip.sha512) {
        try { fs.unlinkSync(dest); } catch {}
        throw new Error('更新包校验失败（sha512 不匹配）');
      }
    }
  }

  macPending = {
    version: yml.version,
    zipPath: dest,
    sha512: zip.sha512,
    fileName: zip.fileName,
    url: zip.url
  };
  setState({ status: 'downloaded', version: yml.version, percent: 100, error: null, mode: 'mac-manual' });
  bus.send('新版本 v' + yml.version + ' 已下载完成', 'success');
  await maybePromptInstall(yml.version);
  return { ok: true, update: true, version: yml.version, state: getState() };
}

async function maybePromptInstall(version) {
  if (promptShownForVersion === version) return;
  promptShownForVersion = version;
  try {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const boxOpts = {
      type: 'info',
      title: '发现新版本',
      message: '新版本 v' + version + ' 已下载完成，是否立即重启更新？',
      detail: isMac()
        ? '当前为未签名构建：将在退出后用本地脚本替换应用程序包并重新打开（不经过 ShipIt）。请确保应用不在 DMG/只读卷中运行。'
        : '将关闭当前窗口并安装更新，安装完成后自动重新打开。',
      buttons: ['立即重启更新', '退出时自动安装'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    };
    const { response } = win && !win.isDestroyed()
      ? await dialog.showMessageBox(win, boxOpts)
      : await dialog.showMessageBox(boxOpts);
    if (response === 0) await quitAndInstall({ silent: false, forceRunAfter: true });
  } catch (err) {
    bus.send('[更新] 弹窗失败: ' + (err && err.message ? err.message : err), 'warn');
  }
}

function quoteSh(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

/**
 * 退出后由独立 shell 完成：解压 zip → 替换 .app → 重新打开
 * 不依赖 ShipIt，未签名包可用。
 */
function launchMacManualInstaller(zipPath, appBundlePath) {
  const parentDir = path.dirname(appBundlePath);
  const appName = path.basename(appBundlePath);
  const staging = path.join(macUpdateDir(), 'staging-' + Date.now());
  const logFile = path.join(macUpdateDir(), 'install.log');
  const scriptPath = path.join(macUpdateDir(), 'install-update.sh');
  const pid = process.pid;

  const script = [
    '#!/bin/bash',
    'set -e',
    'LOG=' + quoteSh(logFile),
    'exec >>"$LOG" 2>&1',
    'echo "[$(date)] mac manual update start"',
    'ZIP=' + quoteSh(zipPath),
    'APP=' + quoteSh(appBundlePath),
    'PARENT=' + quoteSh(parentDir),
    'APP_NAME=' + quoteSh(appName),
    'STAGING=' + quoteSh(staging),
    'PID=' + String(pid),
    '# 等待主进程退出',
    'for i in $(seq 1 60); do',
    '  if ! kill -0 "$PID" 2>/dev/null; then break; fi',
    '  sleep 0.5',
    'done',
    'sleep 1',
    'rm -rf "$STAGING"',
    'mkdir -p "$STAGING"',
    'echo "unzip $ZIP -> $STAGING"',
    'unzip -q -o "$ZIP" -d "$STAGING"',
    '# 在解压目录中找 .app',
    'NEW_APP=$(find "$STAGING" -maxdepth 3 -name "*.app" -type d | head -n 1)',
    'if [ -z "$NEW_APP" ]; then echo "no .app in zip"; exit 1; fi',
    'echo "new app: $NEW_APP"',
    'if [ ! -w "$PARENT" ]; then echo "parent not writable: $PARENT"; exit 2; fi',
    'BACKUP="$APP.bak.$RANDOM"',
    'if [ -d "$APP" ]; then mv "$APP" "$BACKUP"; fi',
    'if ! mv "$NEW_APP" "$APP"; then',
    '  echo "move failed, restore backup"',
    '  if [ -d "$BACKUP" ]; then mv "$BACKUP" "$APP"; fi',
    '  exit 3',
    'fi',
    'rm -rf "$BACKUP" || true',
    'rm -rf "$STAGING" || true',
    'echo "open $APP"',
    'open "$APP" || true',
    'echo "[$(date)] mac manual update done"',
    ''
  ].join('\n');

  fs.mkdirSync(macUpdateDir(), { recursive: true });
  fs.writeFileSync(scriptPath, script, { encoding: 'utf8', mode: 0o755 });
  try { fs.chmodSync(scriptPath, 0o755); } catch {}

  // 独立会话后台跑，父进程退出后仍继续
  const child = spawn('/bin/bash', [scriptPath], {
    detached: true,
    stdio: 'ignore',
    env: process.env
  });
  child.unref();
  return { scriptPath, logFile, pid: child.pid };
}

async function macQuitAndInstall() {
  if (!macPending || !macPending.zipPath || !fs.existsSync(macPending.zipPath)) {
    return { ok: false, error: '未找到已下载的 mac 更新包，请重新检查更新' };
  }
  if (isRunningFromDmg()) {
    return { ok: false, error: '应用正在 DMG/只读卷中运行，无法自动替换。请先拖到「应用程序」文件夹后再更新。' };
  }
  const appBundle = getCurrentAppBundlePath();
  if (!appBundle) {
    return { ok: false, error: '无法定位当前 .app 路径' };
  }
  // 权限探测：用户目录 / 应用程序文件夹
  try {
    fs.accessSync(path.dirname(appBundle), fs.constants.W_OK);
  } catch {
    // 尝试打开 dmg/发布页作为回退
    const releaseUrl = 'https://github.com/' + OWNER + '/' + REPO + '/releases/latest';
    try { await shell.openExternal(releaseUrl); } catch {}
    return {
      ok: false,
      error: '当前安装目录无写权限（' + path.dirname(appBundle) + '）。已打开 GitHub Releases，请手动下载安装。'
    };
  }

  installing = true;
  setState({ status: 'installing', error: null, mode: 'mac-manual' });
  bus.send('[更新] 正在关闭串口/MQTT/子进程，随后用本地脚本替换应用…', 'step');

  let summary = {};
  try {
    summary = await prepareForUpdateInstall();
    if (summary.processes) bus.send('[更新] 已结束 ' + summary.processes + ' 个活动子进程', 'info');
  } catch (e) {
    bus.send('[更新] 资源清理异常: ' + (e && e.message ? e.message : e), 'warn');
  }

  try {
    try { app.removeAllListeners('activate'); } catch {}
    const launched = launchMacManualInstaller(macPending.zipPath, appBundle);
    bus.send('[更新] 已启动替换脚本: ' + launched.scriptPath, 'info');
    scheduleForceExit(8000);
    // 正常退出，脚本等待 PID 结束后替换
    setTimeout(() => {
      try { app.quit(); } catch {}
    }, 300);
    return { ok: true, state: getState(), summary, mode: 'mac-manual', logFile: launched.logFile };
  } catch (err) {
    installing = false;
    const msg = normalizeUpdateError(err);
    setState({ status: 'downloaded', error: msg, mode: 'mac-manual' });
    bus.send('[更新] 启动本地安装失败: ' + msg, 'error');
    return { ok: false, error: msg, state: getState(), summary };
  }
}

/* ── Windows/Linux：electron-updater ─────────────────── */
function getUpdater() {
  if (!autoUpdater) {
    ({ autoUpdater } = require('electron-updater'));
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    if (typeof autoUpdater.verifyUpdateCodeSignature === 'boolean' || 'verifyUpdateCodeSignature' in autoUpdater) {
      autoUpdater.verifyUpdateCodeSignature = false;
    }
    try {
      autoUpdater.logger = {
        info: (...a) => { try { bus.send('[更新] ' + a.join(' '), 'info'); } catch {} },
        warn: (...a) => { try { bus.send('[更新] ' + a.join(' '), 'warn'); } catch {} },
        error: (...a) => { try { bus.send('[更新] ' + a.join(' '), 'error'); } catch {} },
        debug: () => {}
      };
    } catch {}
    wireEvents(autoUpdater);
  }
  return autoUpdater;
}

function wireEvents(u) {
  u.on('checking-for-update', () => {
    if (!installing) setState({ status: 'checking', error: null, mode: 'electron-updater' });
  });
  u.on('update-available', (info) => {
    if (installing) return;
    setState({ status: 'downloading', version: info.version, percent: 0, error: null, mode: 'electron-updater' });
    bus.send('发现新版本 v' + info.version + '，正在后台下载…', 'info');
  });
  u.on('update-not-available', () => {
    if (!installing) setState({ status: 'latest', error: null, mode: 'electron-updater' });
  });
  u.on('download-progress', (p) => {
    if (installing) return;
    const percent = Math.round((p && p.percent) || 0);
    if (state.status === 'downloading' && state.percent === percent) return;
    setState({ status: 'downloading', percent, mode: 'electron-updater' });
    bus.sendProgress('app-update', '下载更新 v' + (state.version || '') + ': ' + percent + '%');
  });
  u.on('update-downloaded', async (info) => {
    if (installing) return;
    const version = info && info.version ? info.version : state.version;
    setState({ status: 'downloaded', version, percent: 100, error: null, mode: 'electron-updater' });
    bus.send('新版本 v' + version + ' 已下载完成', 'success');
    await maybePromptInstall(version);
  });
  u.on('error', (err) => {
    // mac 上若误走 electron-updater 并撞上 ShipIt 签名错误，自动切自管通道
    if (isMac() && isSignatureError(err)) {
      bus.send('[更新] 检测到 ShipIt 签名校验失败，切换到 mac 自管更新通道…', 'warn');
      macCheckAndDownload().catch((e) => {
        const msg = normalizeUpdateError(e);
        if (installing) installing = false;
        setState({ status: 'error', error: msg, mode: 'mac-manual' });
        bus.send('检查/下载更新失败: ' + msg, 'warn');
      });
      return;
    }
    const msg = normalizeUpdateError(err);
    if (installing) installing = false;
    setState({ status: 'error', error: msg });
    const now = Date.now();
    if (now - lastErrorAt > 3000) {
      lastErrorAt = now;
      bus.send('检查/下载更新失败: ' + msg, 'warn');
    }
  });
}

async function prepareForUpdateInstall() {
  const summary = { serial: false, mqtt: false, http: false, processes: 0, tray: false };
  try {
    const windows = require('../windows');
    if (windows && typeof windows.prepareForQuit === 'function') {
      windows.prepareForQuit();
      summary.tray = true;
    } else {
      app.isQuitting = true;
    }
  } catch {
    try { app.isQuitting = true; } catch {}
  }
  try {
    const serial = require('../devices/serial');
    if (typeof serial.closeActiveSerial === 'function') {
      await serial.closeActiveSerial();
      summary.serial = true;
    }
  } catch {}
  try {
    const mqtt = require('../devices/mqtt');
    if (typeof mqtt.closeAllMqtt === 'function') {
      mqtt.closeAllMqtt();
      summary.mqtt = true;
    }
  } catch {}
  try {
    const httpApi = require('./http-server');
    if (httpApi && typeof httpApi.stop === 'function') {
      await Promise.race([
        httpApi.stop(),
        new Promise((resolve) => setTimeout(resolve, 1500))
      ]);
      summary.http = true;
    }
  } catch {}
  try {
    const proc = require('../toolchain/proc');
    if (typeof proc.killAllRunningProcesses === 'function') {
      const r = proc.killAllRunningProcesses('update-install');
      summary.processes = r && r.killed ? r.killed : 0;
    }
  } catch {}
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.removeAllListeners('close'); } catch {}
      try { if (!win.isDestroyed()) win.destroy(); } catch {}
    }
  } catch {}
  return summary;
}

function scheduleForceExit(ms) {
  const defaultWait = isMac() ? 12000 : 5000;
  const wait = typeof ms === 'number' ? ms : defaultWait;
  if (forceExitTimer) clearTimeout(forceExitTimer);
  forceExitTimer = setTimeout(() => {
    try { bus.send('[更新] 退出超时，强制结束进程以继续安装', 'warn'); } catch {}
    try { app.exit(0); } catch {}
    try { process.exit(0); } catch {}
  }, wait);
  if (forceExitTimer.unref) forceExitTimer.unref();
}

// 启动后延迟检查，避免拖慢首屏；开发模式（未打包）不检查
function checkOnStartup(delayMs) {
  if (!app.isPackaged) return;
  if (isMac() && isRunningFromDmg()) {
    bus.send('[更新] 检测到应用正在 DMG/只读卷中运行，自动更新可能失败；请先拖到「应用程序」文件夹再使用', 'warn');
  }
  setTimeout(() => {
    checkNow().catch(() => {});
  }, typeof delayMs === 'number' ? delayMs : 5000);
}

// 手动检查（供渲染层"检查更新"按钮调用）
async function checkNow() {
  if (!app.isPackaged) return { ok: false, error: '开发模式不支持更新' };
  if (installing) return { ok: false, error: '正在安装更新，请稍候' };
  if (state.status === 'downloading') return { ok: true, state: getState(), note: 'already-downloading' };
  if (state.status === 'downloaded') return { ok: true, state: getState(), note: 'already-downloaded' };

  // mac 未签名：始终走自管通道，避免 ShipIt 签名失败
  if (isMac()) {
    try {
      return await macCheckAndDownload();
    } catch (err) {
      const msg = normalizeUpdateError(err);
      setState({ status: 'error', error: msg, mode: 'mac-manual' });
      return { ok: false, error: msg, state: getState() };
    }
  }

  try {
    setState({ status: 'checking', error: null, mode: 'electron-updater' });
    const result = await getUpdater().checkForUpdates();
    return { ok: true, state: getState(), updateInfo: result && result.updateInfo ? result.updateInfo : null };
  } catch (err) {
    const msg = normalizeUpdateError(err);
    setState({ status: 'error', error: msg });
    return { ok: false, error: msg, state: getState() };
  }
}

async function quitAndInstall(opts) {
  opts = opts || {};
  if (installing) return { ok: true, state: getState(), note: 'already-installing' };
  if (state.status !== 'downloaded' && state.status !== 'installing') {
    return { ok: false, error: '更新包尚未下载完成', state: getState() };
  }

  if (isMac()) {
    return macQuitAndInstall();
  }

  installing = true;
  setState({ status: 'installing', error: null, mode: 'electron-updater' });
  bus.send('[更新] 正在关闭串口/MQTT/子进程并准备安装…', 'step');

  let summary = {};
  try {
    summary = await prepareForUpdateInstall();
    if (summary.processes) bus.send('[更新] 已结束 ' + summary.processes + ' 个活动子进程', 'info');
  } catch (e) {
    bus.send('[更新] 资源清理异常: ' + (e && e.message ? e.message : e), 'warn');
  }

  const silent = opts.silent === true;
  const forceRunAfter = opts.forceRunAfter !== false;
  try {
    try { app.removeAllListeners('activate'); } catch {}
    getUpdater().quitAndInstall(silent, forceRunAfter);
    scheduleForceExit(5000);
    bus.send('[更新] 已请求退出并安装，若窗口未关闭将在数秒后强制结束', 'info');
    return { ok: true, state: getState(), summary };
  } catch (err) {
    installing = false;
    const msg = normalizeUpdateError(err);
    setState({ status: 'downloaded', error: msg });
    bus.send('[更新] 启动安装失败: ' + msg, 'error');
    return { ok: false, error: msg, state: getState(), summary };
  }
}

module.exports = {
  checkOnStartup,
  checkNow,
  quitAndInstall,
  getState,
  prepareForUpdateInstall,
  broadcastState
};
