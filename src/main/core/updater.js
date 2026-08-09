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
const crypto = require('crypto');
const { spawn } = require('child_process');
const bus = require('./bus');
const { loadConfig } = require('./config');
const {
  OWNER,
  REPO,
  OFFICIAL_LATEST_DOWNLOAD_URL,
  officialUpdateSource,
  resolveConfiguredUpdateSource,
  resolveSecureUpdateUrl,
  getArtifactFileName,
  officialReleaseAssetUrl
} = require('./update-source');

let autoUpdater = null;
let state = { status: 'idle', version: null, percent: 0, error: null, platform: process.platform, mode: null, source: null };
let installing = false;
let forceExitTimer = null;
let promptShownForVersion = null;
let lastErrorAt = 0;
let activeUpdateSource = officialUpdateSource();
let suppressUpdaterErrors = false;
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
  if (/ENOENT|latest(?:-[a-z0-9-]+)?\.yml|Cannot find channel|ERR_UPDATER_CHANNEL_FILE_NOT_FOUND/i.test(raw)) {
    return raw + '（更新源缺少平台清单或发布文件；自定义镜像需要同步 latest*.yml 与安装包，并建议同步差分更新所需的 blockmap）';
  }
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|net::|403|429|rate limit/i.test(raw)) {
    return raw + '（更新源访问失败，可稍后重试或检查应用更新镜像配置）';
  }
  return raw;
}

/* ── 通用：下载 / 请求 ─────────────────────────────────── */
function requestText(inputUrl, redirects = 0) {
  let url;
  try {
    url = resolveSecureUpdateUrl(OFFICIAL_LATEST_DOWNLOAD_URL, inputUrl, '更新清单地址');
  } catch (e) {
    return Promise.reject(e);
  }
  return new Promise((resolve, reject) => {
    if (redirects > 8) return reject(new Error('too many redirects'));
    const req = https.get(url, {
      headers: {
        'User-Agent': 'MCUToolbox-Updater',
        Accept: 'application/octet-stream, text/yaml, */*'
      },
      timeout: 30000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        let next;
        try { next = resolveSecureUpdateUrl(url, res.headers.location, '更新重定向地址'); }
        catch (e) { return reject(e); }
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

function downloadFile(inputUrl, dest, onProgress, redirects = 0) {
  let url;
  try {
    url = resolveSecureUpdateUrl(OFFICIAL_LATEST_DOWNLOAD_URL, inputUrl, '更新包地址');
  } catch (e) {
    return Promise.reject(e);
  }
  const tmp = dest + '.part';
  const cleanupTmp = () => { try { fs.unlinkSync(tmp); } catch {} };
  cleanupTmp();
  return new Promise((resolve, reject) => {
    if (redirects > 8) return reject(new Error('too many redirects'));
    const req = https.get(url, {
      headers: {
        'User-Agent': 'MCUToolbox-Updater',
        Accept: 'application/octet-stream, */*'
      },
      timeout: 120000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        let next;
        try { next = resolveSecureUpdateUrl(url, res.headers.location, '更新重定向地址'); }
        catch (e) { return reject(e); }
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
            try { fs.unlinkSync(dest); } catch {}
            fs.renameSync(tmp, dest);
            resolve({ path: dest, size: received, url });
          } catch (e) {
            cleanupTmp();
            reject(e);
          }
        });
      });
      out.on('error', (e) => {
        cleanupTmp();
        reject(e);
      });
      res.on('error', (e) => {
        cleanupTmp();
        reject(e);
      });
      res.on('aborted', () => {
        cleanupTmp();
        reject(new Error('download aborted'));
      });
    });
    req.on('timeout', () => { req.destroy(new Error('download timeout')); });
    req.on('error', (e) => { cleanupTmp(); reject(e); });
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

function isZipReference(value) {
  try {
    return /\.zip$/i.test(new URL(String(value || ''), OFFICIAL_LATEST_DOWNLOAD_URL).pathname);
  } catch {
    return false;
  }
}

function pickMacZipFile(yml, source) {
  const files = Array.isArray(yml.files) ? yml.files : [];
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const names = files.map((f) => f.url || f.path || '').filter(Boolean);
  // 优先：匹配当前 arch 的 zip → universal → path 字段 → 任意 zip
  const prefer = [
    names.find((n) => isZipReference(n) && n.includes(arch)),
    names.find((n) => isZipReference(n) && /universal/i.test(n)),
    (yml.path && isZipReference(yml.path) ? yml.path : null),
    names.find((n) => isZipReference(n))
  ].filter(Boolean);
  const chosen = prefer[0];
  if (!chosen) return null;
  const meta = files.find((f) => (f.url || f.path) === chosen) || {};
  const fileName = getArtifactFileName(chosen);
  return {
    reference: chosen,
    fileName,
    sha512: meta.sha512 || yml.sha512 || null,
    url: source.provider === 'generic'
      ? resolveSecureUpdateUrl(source.feedUrl, chosen, 'macOS 更新包地址')
      : officialReleaseAssetUrl(yml.version, chosen)
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
function configuredUpdateSource() {
  try {
    return resolveConfiguredUpdateSource(loadConfig());
  } catch (e) {
    bus.send('[更新] 应用更新镜像配置无效，将使用 GitHub 官方源：' + (e && e.message ? e.message : e), 'warn');
    return officialUpdateSource({ fallback: true });
  }
}

async function loadMacUpdateInfo(source) {
  const ymlUrl = resolveSecureUpdateUrl(source.feedUrl, 'latest-mac.yml', 'macOS 更新清单地址');
  const text = await requestText(ymlUrl);
  const yml = parseLatestYml(text);
  if (!yml.version) throw new Error('latest-mac.yml 缺少 version');
  return { yml, source };
}

async function loadMacUpdateInfoWithFallback() {
  const preferred = configuredUpdateSource();
  try {
    return await loadMacUpdateInfo(preferred);
  } catch (mirrorError) {
    if (preferred.provider !== 'generic') throw mirrorError;
    const fallback = officialUpdateSource({ fallback: true });
    bus.send('[更新] 自定义镜像清单不可用，回退 GitHub 官方源：' + (mirrorError && mirrorError.message ? mirrorError.message : mirrorError), 'warn');
    try {
      return await loadMacUpdateInfo(fallback);
    } catch (officialError) {
      throw new Error(
        '更新镜像失败：' + (mirrorError && mirrorError.message ? mirrorError.message : mirrorError) +
        '；GitHub 官方源也失败：' + (officialError && officialError.message ? officialError.message : officialError)
      );
    }
  }
}

async function downloadAndVerifyMacPackage(url, dest, sha512, onProgress) {
  const result = await downloadFile(url, dest, onProgress);
  const got = await sha512File(dest);
  if (got !== sha512) {
    try { fs.unlinkSync(dest); } catch {}
    throw new Error('更新包校验失败（sha512 不匹配）');
  }
  return result;
}

async function macCheckAndDownload() {
  setState({ status: 'checking', error: null, mode: 'mac-manual' });
  let resolved;
  try {
    resolved = await loadMacUpdateInfoWithFallback();
  } catch (e) {
    throw new Error('获取 latest-mac.yml 失败: ' + (e && e.message ? e.message : e));
  }
  let { yml, source } = resolved;
  const current = app.getVersion();
  if (!isNewerVersion(yml.version, current)) {
    setState({ status: 'latest', version: yml.version, percent: 0, error: null, mode: 'mac-manual', source: source.kind });
    return { ok: true, update: false, version: yml.version, state: getState() };
  }
  let zip;
  try {
    zip = pickMacZipFile(yml, source);
    if (!zip) throw new Error('latest-mac.yml 中未找到 zip 更新包');
    if (!zip.sha512) throw new Error('latest-mac.yml 中的 zip 更新包缺少 sha512');
  } catch (mirrorMetadataError) {
    if (source.provider !== 'generic') throw mirrorMetadataError;
    const fallback = officialUpdateSource({ fallback: true });
    bus.send('[更新] 自定义镜像清单不完整，回退 GitHub 官方源：' + (mirrorMetadataError && mirrorMetadataError.message ? mirrorMetadataError.message : mirrorMetadataError), 'warn');
    try {
      ({ yml, source } = await loadMacUpdateInfo(fallback));
      if (!isNewerVersion(yml.version, current)) {
        setState({ status: 'latest', version: yml.version, percent: 0, error: null, mode: 'mac-manual', source: source.kind });
        return { ok: true, update: false, version: yml.version, state: getState() };
      }
      zip = pickMacZipFile(yml, source);
      if (!zip) throw new Error('latest-mac.yml 中未找到 zip 更新包');
      if (!zip.sha512) throw new Error('latest-mac.yml 中的 zip 更新包缺少 sha512');
    } catch (officialError) {
      throw new Error(
        '更新镜像清单无效：' + (mirrorMetadataError && mirrorMetadataError.message ? mirrorMetadataError.message : mirrorMetadataError) +
        '；GitHub 官方源也失败：' + (officialError && officialError.message ? officialError.message : officialError)
      );
    }
  }

  setState({ status: 'downloading', version: yml.version, percent: 0, error: null, mode: 'mac-manual', source: source.kind });
  bus.send('发现新版本 v' + yml.version + '，正在通过' + source.label + '后台下载（mac 自管，绕过 ShipIt）…', 'info');

  const dest = path.join(macUpdateDir(), zip.fileName);
  // 若已有同版本文件且 sha 匹配，跳过下载
  let needDownload = true;
  if (fs.existsSync(dest) && zip.sha512) {
    try {
      const got = await sha512File(dest);
      if (got === zip.sha512) needDownload = false;
    } catch {}
  }
  if (needDownload && fs.existsSync(dest)) {
    try { fs.unlinkSync(dest); } catch {}
  }
  let downloadedUrl = zip.url;
  let downloadedSource = source.kind;
  if (needDownload) {
    const onProgress = (pct) => {
      if (state.status === 'downloading' && state.percent === pct) return;
      setState({ status: 'downloading', version: yml.version, percent: pct, mode: 'mac-manual', source: downloadedSource });
      bus.sendProgress('app-update', '下载更新 v' + yml.version + ': ' + pct + '%');
    };
    try {
      await downloadAndVerifyMacPackage(zip.url, dest, zip.sha512, onProgress);
    } catch (mirrorError) {
      if (source.provider !== 'generic') throw mirrorError;
      downloadedUrl = officialReleaseAssetUrl(yml.version, zip.reference);
      downloadedSource = 'github-fallback';
      setState({ status: 'downloading', version: yml.version, percent: 0, error: null, mode: 'mac-manual', source: downloadedSource });
      bus.send('[更新] 镜像更新包下载或校验失败，回退 GitHub 官方源：' + (mirrorError && mirrorError.message ? mirrorError.message : mirrorError), 'warn');
      try {
        await downloadAndVerifyMacPackage(downloadedUrl, dest, zip.sha512, onProgress);
      } catch (officialError) {
        throw new Error(
          '更新镜像下载失败：' + (mirrorError && mirrorError.message ? mirrorError.message : mirrorError) +
          '；GitHub 官方源也失败：' + (officialError && officialError.message ? officialError.message : officialError)
        );
      }
    }
  }

  macPending = {
    version: yml.version,
    zipPath: dest,
    sha512: zip.sha512,
    fileName: zip.fileName,
    url: downloadedUrl
  };
  setState({ status: 'downloaded', version: yml.version, percent: 100, error: null, mode: 'mac-manual', source: downloadedSource });
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
    try { app.updateQuitPrepared = true; } catch {}
    // 正常退出，脚本等待 PID 结束后替换
    setTimeout(() => {
      try { app.quit(); } catch {}
    }, 300);
    return { ok: true, state: getState(), summary, mode: 'mac-manual', logFile: launched.logFile };
  } catch (err) {
    try { app.updateQuitPrepared = false; } catch {}
    installing = false;
    const msg = normalizeUpdateError(err);
    setState({ status: 'downloaded', error: msg, mode: 'mac-manual' });
    bus.send('[更新] 启动本地安装失败: ' + msg, 'error');
    return { ok: false, error: msg, state: getState(), summary };
  }
}

/* ── Windows/Linux：electron-updater ─────────────────── */
function configureUpdaterSource(u, source) {
  if (source.provider === 'generic') {
    u.setFeedURL({
      provider: 'generic',
      url: source.feedUrl,
      // 国内 CDN / GitHub 代理对 multipart range 的兼容性差异较大，
      // 禁用多区间合并请求，仍保留普通 Range 与差分更新能力。
      useMultipleRangeRequest: false
    });
  } else {
    u.setFeedURL({ provider: 'github', owner: OWNER, repo: REPO, releaseType: 'release' });
  }
  activeUpdateSource = source;
  return source;
}

function getUpdater() {
  if (!autoUpdater) {
    ({ autoUpdater } = require('electron-updater'));
    // 由 checkNow 显式等待下载，便于镜像在清单或安装包失败时完整回退官方源。
    autoUpdater.autoDownload = false;
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
    if (!installing) setState({ status: 'checking', error: null, mode: 'electron-updater', source: activeUpdateSource.kind });
  });
  u.on('update-available', (info) => {
    if (installing) return;
    setState({ status: 'downloading', version: info.version, percent: 0, error: null, mode: 'electron-updater', source: activeUpdateSource.kind });
    bus.send('发现新版本 v' + info.version + '，正在通过' + activeUpdateSource.label + '后台下载…', 'info');
  });
  u.on('update-not-available', () => {
    if (!installing) setState({ status: 'latest', error: null, mode: 'electron-updater', source: activeUpdateSource.kind });
  });
  u.on('download-progress', (p) => {
    if (installing) return;
    const percent = Math.round((p && p.percent) || 0);
    if (state.status === 'downloading' && state.percent === percent) return;
    setState({ status: 'downloading', percent, mode: 'electron-updater', source: activeUpdateSource.kind });
    bus.sendProgress('app-update', '下载更新 v' + (state.version || '') + ': ' + percent + '%');
  });
  u.on('update-downloaded', async (info) => {
    if (installing) return;
    const version = info && info.version ? info.version : state.version;
    setState({ status: 'downloaded', version, percent: 100, error: null, mode: 'electron-updater', source: activeUpdateSource.kind });
    bus.send('新版本 v' + version + ' 已下载完成', 'success');
    await maybePromptInstall(version);
  });
  u.on('error', (err) => {
    // checkNow 会捕获当前尝试并在镜像失败时切到官方源，避免界面先闪现一次错误状态。
    if (suppressUpdaterErrors) return;
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

async function runUpdaterAttempt(source) {
  const updater = getUpdater();
  configureUpdaterSource(updater, source);
  setState({ status: 'checking', error: null, mode: 'electron-updater', source: source.kind });

  suppressUpdaterErrors = true;
  try {
    const result = await updater.checkForUpdates();
    if (result && result.isUpdateAvailable) {
      await updater.downloadUpdate(result.cancellationToken);
    }
    return result;
  } finally {
    suppressUpdaterErrors = false;
  }
}

async function checkElectronUpdaterWithFallback() {
  const preferred = configuredUpdateSource();
  try {
    return { result: await runUpdaterAttempt(preferred), source: preferred };
  } catch (mirrorError) {
    if (preferred.provider !== 'generic') throw mirrorError;
    const fallback = officialUpdateSource({ fallback: true });
    bus.send('[更新] 自定义镜像检查或下载失败，回退 GitHub 官方源：' + (mirrorError && mirrorError.message ? mirrorError.message : mirrorError), 'warn');
    try {
      return { result: await runUpdaterAttempt(fallback), source: fallback };
    } catch (officialError) {
      throw new Error(
        '更新镜像失败：' + (mirrorError && mirrorError.message ? mirrorError.message : mirrorError) +
        '；GitHub 官方源也失败：' + (officialError && officialError.message ? officialError.message : officialError)
      );
    }
  }
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
    const { result } = await checkElectronUpdaterWithFallback();
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
    try { app.updateQuitPrepared = true; } catch {}
    getUpdater().quitAndInstall(silent, forceRunAfter);
    scheduleForceExit(5000);
    bus.send('[更新] 已请求退出并安装，若窗口未关闭将在数秒后强制结束', 'info');
    return { ok: true, state: getState(), summary };
  } catch (err) {
    try { app.updateQuitPrepared = false; } catch {}
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
