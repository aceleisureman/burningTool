// 编译环境探测与工具链管理：系统信息、busybox/默认工具链安装、可执行路径解析。
// 日志经 bus 发往渲染端；进程执行复用 proc。
const { app } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { getToolchainDownloadPlan } = require('./platform-toolchains');
const { PLATFORM_TC, loadConfig } = require('../core/config');
const { applyMirror, downloadFast } = require('./downloader');
const bus = require('../core/bus');
const { runProcess } = require('./proc');

const APPLETS = [
  'sh', 'rm', 'rmdir', 'mkdir', 'cp', 'mv', 'cat', 'echo', 'touch', 'ls',
  'sed', 'printf', 'test', 'expr', 'true', 'false', 'dirname', 'basename',
  'find', 'grep', 'head', 'tail', 'wc', 'sleep', 'env', 'sort', 'uniq',
  'cut', 'tr', 'xargs', 'date', 'pwd', 'cmp', 'diff'
];

const SYSTEM_COMMAND_TOOLS = {
  macos: [
    'sh', 'zsh', 'rm', 'rmdir', 'mkdir', 'cp', 'mv', 'cat', 'echo', 'touch',
    'ls', 'sed', 'awk', 'printf', 'test', 'find', 'grep', 'head', 'tail',
    'wc', 'sleep', 'env', 'sort', 'uniq', 'cut', 'tr', 'xargs', 'date',
    'pwd', 'dirname', 'basename', 'cmp', 'diff'
  ],
  linux: [
    'sh', 'bash', 'rm', 'rmdir', 'mkdir', 'cp', 'mv', 'cat', 'echo', 'touch',
    'ls', 'sed', 'awk', 'printf', 'test', 'find', 'grep', 'head', 'tail',
    'wc', 'sleep', 'env', 'sort', 'uniq', 'cut', 'tr', 'xargs', 'date',
    'pwd', 'dirname', 'basename', 'cmp', 'diff', 'ln', 'chmod'
  ]
};

function readHostSystemInfo() {
  const info = {
    platform: process.platform,
    arch: process.arch,
    type: os.type(),
    release: os.release(),
    version: os.version ? os.version() : os.release(),
    displayVersion: os.release()
  };
  if (process.platform === 'darwin') {
    const r = spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' });
    if (!r.error && r.status === 0 && r.stdout.trim()) info.displayVersion = r.stdout.trim();
  }
  return info;
}

function systemLogLabel() {
  const info = readHostSystemInfo();
  return `${PLATFORM_TC.label} ${info.displayVersion || info.release || ''} (${info.platform}/${info.arch})`.trim();
}

/* ── 编译环境（busybox）安装与探测 ─────────────────────── */
function toolsDir() {
  return path.join(app.getPath('userData'), 'tools');
}

// 同时检索 app 同级目录与 userData，二者都注入 PATH
function toolsSearchDirs() {
  return PLATFORM_TC.commandTools.mode === 'busybox'
    ? [path.join(__dirname, '..', '..', '..', 'resources', 'tools'), toolsDir()]
    : [];
}

function isToolchainInstalled() {
  if (PLATFORM_TC.commandTools.mode !== 'busybox') return true;
  return toolsSearchDirs().some((d) => fs.existsSync(path.join(d, 'rm.exe')));
}

/* ── 工具链路径解析（custom / default 两种模式）─────────── */
// 软件根目录：开发态=仓库根；打包态=可执行文件所在目录（安装/便携根目录）
function appInstallRoot() {
  if (app.isPackaged || String(__dirname).includes('app.asar')) {
    return path.dirname(app.getPath('exe'));
  }
  return path.join(__dirname, '..', '..', '..');
}

// 可写工具链根目录：
// - 开发态：仓库根 toolchain/（方便查看）
// - 打包态：userData/toolchain（升级安装不会被 NSIS 覆盖删除）
// 旧版曾写在软件安装目录 toolchain/，读取时仍兼容。
function preferredToolchainRoot(cfg) {
  // 优先使用用户指定的保存目录；留空则：打包态 userData/toolchain，开发态仓库根 toolchain/
  let custom = '';
  try {
    const c = cfg || loadConfig() || {};
    custom = expandHomePath(String(c.toolchainRootPath || '').trim());
  } catch {}
  if (custom) return path.resolve(custom);
  if (app.isPackaged || String(__dirname).includes('app.asar')) {
    return path.join(app.getPath('userData'), 'toolchain');
  }
  return path.join(appInstallRoot(), 'toolchain');
}

function legacyToolchainRoot() {
  return path.join(appInstallRoot(), 'toolchain');
}

function samePath(a, b) {
  try {
    const na = path.resolve(String(a || ''));
    const nb = path.resolve(String(b || ''));
    return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb;
  } catch {
    return false;
  }
}

function toolchainSearchRoots() {
  const roots = [];
  const push = (p) => {
    if (!p) return;
    if (roots.some((x) => samePath(x, p))) return;
    roots.push(p);
  };
  push(preferredToolchainRoot());
  push(legacyToolchainRoot());
  return roots;
}

function toolchainRoot() {
  return preferredToolchainRoot();
}

// 若旧安装目录仍有工具链、新目录为空，尝试迁移到 userData（失败则继续兼容读取旧目录）
function migrateLegacyToolchainIfNeeded() {
  const dest = preferredToolchainRoot();
  const src = legacyToolchainRoot();
  if (samePath(src, dest)) return { migrated: false, reason: 'same-root' };
  if (!fs.existsSync(src)) return { migrated: false, reason: 'no-legacy' };
  let destHas = false;
  try {
    destHas = fs.existsSync(dest) && fs.readdirSync(dest).length > 0;
  } catch {}
  if (destHas) return { migrated: false, reason: 'dest-exists' };
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
    bus.send('[环境] 已将旧工具链目录迁移到应用数据目录（升级后保留）: ' + dest, 'success');
    return { migrated: true, from: src, to: dest };
  } catch (e) {
    bus.send('[环境] 旧工具链目录迁移失败，将继续兼容读取: ' + (e && e.message ? e.message : e), 'warn');
    bus.send('[环境] 旧目录: ' + src, 'info');
    bus.send('[环境] 新目录: ' + dest, 'info');
    return { migrated: false, reason: 'rename-failed', error: String(e && e.message || e), from: src, to: dest };
  }
}

function resolveUnderToolchain(relParts, predicate) {
  const parts = Array.isArray(relParts) ? relParts : [relParts];
  for (const root of toolchainSearchRoots()) {
    const pth = path.join(root, ...parts);
    if (typeof predicate === 'function') {
      if (predicate(pth, root)) return pth;
    } else if (fs.existsSync(pth)) {
      return pth;
    }
  }
  return path.join(preferredToolchainRoot(), ...parts);
}

function localPyocdRoot() {
  const hit = resolveUnderToolchain(['pyocd'], (p) => fs.existsSync(p));
  return fs.existsSync(hit) ? hit : path.join(preferredToolchainRoot(), 'pyocd');
}

function localPyocdBin() {
  const rel = process.platform === 'win32'
    ? ['pyocd', 'Scripts', 'pyocd.exe']
    : ['pyocd', 'bin', 'pyocd'];
  return resolveUnderToolchain(rel, (p) => fs.existsSync(p));
}

function localStcgalRoot() {
  const hit = resolveUnderToolchain(['stcgal'], (p) => fs.existsSync(p));
  return fs.existsSync(hit) ? hit : path.join(preferredToolchainRoot(), 'stcgal');
}

function localStcgalPython() {
  return process.platform === 'win32'
    ? resolveUnderToolchain(['stcgal', 'Scripts', 'python.exe'], (p) => fs.existsSync(p))
    : resolveUnderToolchain(['stcgal', 'bin', 'python'], (p) => fs.existsSync(p));
}

function localStcgalBin() {
  return process.platform === 'win32'
    ? resolveUnderToolchain(['stcgal', 'Scripts', 'stcgal.exe'], (p) => fs.existsSync(p))
    : resolveUnderToolchain(['stcgal', 'bin', 'stcgal'], (p) => fs.existsSync(p));
}

function localEsptoolRoot() {
  const hit = resolveUnderToolchain(['esptool'], (p) => fs.existsSync(p));
  return fs.existsSync(hit) ? hit : path.join(preferredToolchainRoot(), 'esptool');
}

function localEsptoolPython() {
  return process.platform === 'win32'
    ? resolveUnderToolchain(['esptool', 'Scripts', 'python.exe'], (p) => fs.existsSync(p))
    : resolveUnderToolchain(['esptool', 'bin', 'python'], (p) => fs.existsSync(p));
}

function localEsptoolBin() {
  return process.platform === 'win32'
    ? resolveUnderToolchain(['esptool', 'Scripts', 'esptool.exe'], (p) => fs.existsSync(p))
    : resolveUnderToolchain(['esptool', 'bin', 'esptool'], (p) => fs.existsSync(p));
}

function localOpenocdRoot() {
  for (const root of toolchainSearchRoots()) {
    const pth = path.join(root, 'openocd');
    if (fs.existsSync(pth)) return pth;
  }
  return path.join(preferredToolchainRoot(), 'openocd');
}

function localOpenocdBin() {
  const name = process.platform === 'win32' ? 'openocd.exe' : 'openocd';
  const dir = findExeDir(localOpenocdRoot(), name);
  return dir ? path.join(dir, name) : '';
}

// 在 root 下（有限深度）查找包含 exeName 的目录。
// 结果按 (root, exeName) 缓存：OpenOCD 等发行包内有上千个文件，effectivePaths 在
// 一次编译/烧录流程里会被反复调用，Windows(NTFS+Defender) 下重复递归扫描很慢。
// 命中缓存时先验证文件仍存在，被删除/移动则重新扫描。
const _exeDirCache = new Map();
function findExeDir(root, exeName, depth = 4) {
  const cacheKey = `${root}::${exeName.toLowerCase()}`;
  const hit = _exeDirCache.get(cacheKey);
  if (hit) {
    if (fs.existsSync(path.join(hit, exeName))) return hit;
    _exeDirCache.delete(cacheKey);
  }
  if (!fs.existsSync(root)) return null;
  const stack = [{ dir: root, d: 0 }];
  while (stack.length) {
    const { dir, d } = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isFile() && e.name.toLowerCase() === exeName.toLowerCase()) {
        _exeDirCache.set(cacheKey, dir);
        return dir;
      }
    }
    if (d < depth) {
      for (const e of entries) {
        if (e.isDirectory()) stack.push({ dir: path.join(dir, e.name), d: d + 1 });
      }
    }
  }
  return null;
}

// 根据工具链模式返回实际使用的路径
function effectivePaths(cfg) {
  if (cfg.toolchainMode === 'default') {
    const gccName = process.platform === 'win32' ? 'arm-none-eabi-gcc.exe' : 'arm-none-eabi-gcc';
    const makeName = process.platform === 'win32' ? 'make.exe' : 'make';
    let gccDir = '';
    let makeDir = '';
    for (const root of toolchainSearchRoots()) {
      if (!gccDir) gccDir = findExeDir(path.join(root, 'gcc'), gccName) || '';
      if (!makeDir && PLATFORM_TC.defaultDownloads.make.mode === 'download') {
        makeDir = findExeDir(path.join(root, 'make'), makeName) || '';
      }
    }
    return {
      armGccPath: gccDir || cfg.armGccPath,
      makePath:   PLATFORM_TC.defaultDownloads.make.mode === 'download'
        ? (makeDir || cfg.makePath)
        : cfg.makePath,
      pyocdPath:  fs.existsSync(localPyocdBin()) ? localPyocdBin() : cfg.pyocdPath,
      openocdPath: localOpenocdBin() || cfg.openocdPath
    };
  }
  return { armGccPath: cfg.armGccPath, makePath: cfg.makePath, pyocdPath: cfg.pyocdPath, openocdPath: cfg.openocdPath };
}

function defaultToolchainStatus() {
  migrateLegacyToolchainIfNeeded();
  const root = preferredToolchainRoot();
  const gccName = process.platform === 'win32' ? 'arm-none-eabi-gcc.exe' : 'arm-none-eabi-gcc';
  const makeName = process.platform === 'win32' ? 'make.exe' : 'make';
  let gccBin = '';
  let makeBin = PLATFORM_TC.defaultDownloads.make.mode === 'download' ? '' : 'system';
  for (const r of toolchainSearchRoots()) {
    if (!gccBin) gccBin = findExeDir(path.join(r, 'gcc'), gccName) || '';
    if (PLATFORM_TC.defaultDownloads.make.mode === 'download' && !makeBin) {
      makeBin = findExeDir(path.join(r, 'make'), makeName) || '';
    }
  }
  const pyocdBin = fs.existsSync(localPyocdBin()) ? localPyocdBin() : '';
  const openocdBin = localOpenocdBin();
  const busyboxBin = findBusyboxBin();
  return {
    root,
    toolchainRootPath: (function(){ try { return String((loadConfig()||{}).toolchainRootPath||""); } catch { return ""; } })(),
    searchRoots: toolchainSearchRoots(),
    gccBin,
    makeBin,
    busybox: isToolchainInstalled(),
    pyocdBin,
    openocdBin,
    gccVersion: gccBin ? commandVersion(path.join(gccBin, gccName), ['--version'], 'gcc') : '',
    makeVersion: commandVersion(makeBin === 'system' ? 'make' : (makeBin ? path.join(makeBin, makeName) : ''), ['--version'], 'make'),
    pyocdVersion: pyocdBin ? commandVersion(pyocdBin, ['--version'], 'pyocd') : '',
    openocdVersion: openocdBin ? commandVersion(openocdBin, ['--version'], 'openocd') : '',
    busyboxVersion: busyboxBin ? commandVersion(busyboxBin, ['--help'], 'busybox') : '',
    commandTools: supportedCommandTools(),
    platform: PLATFORM_TC.id,
    supportsKeil: PLATFORM_TC.supportsKeil,
    commandToolsMode: PLATFORM_TC.commandTools.mode,
    makeMode: PLATFORM_TC.defaultDownloads.make.mode
  };
}

function supportedCommandTools(platformId = PLATFORM_TC.id) {
  if (platformId === 'windows') return APPLETS.slice();
  return (SYSTEM_COMMAND_TOOLS[platformId] || SYSTEM_COMMAND_TOOLS.linux).slice();
}

function findBusyboxBin() {
  for (const dir of toolsSearchDirs()) {
    const p = path.join(dir, process.platform === 'win32' ? 'busybox.exe' : 'busybox');
    if (fs.existsSync(p)) return p;
  }
  return '';
}

function commandVersion(cmd, args, tool) {
  if (!cmd) return '';
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 2500 });
    const text = `${r.stdout || ''}\n${r.stderr || ''}`;
    return parseToolVersion(tool, text);
  } catch {
    return '';
  }
}

function parseToolVersion(tool, output) {
  const text = String(output || '').trim();
  if (!text) return '';
  let m;
  if (tool === 'gcc') {
    m = text.match(/arm-none-eabi-gcc[^\n]*\s(\d+(?:\.\d+)+(?:[-+.\w]*)?)/i);
    return m ? m[1] : firstVersion(text);
  }
  if (tool === 'make') {
    m = text.match(/GNU Make\s+(\d+(?:\.\d+)+)/i);
    return m ? m[1] : firstVersion(text);
  }
  if (tool === 'pyocd') {
    m = text.match(/(?:pyocd|pyOCD)\s+(\d+(?:\.\d+)+(?:[-+.\w]*)?)/i);
    return m ? m[1] : firstVersion(text);
  }
  if (tool === 'openocd') {
    m = text.match(/(?:Open On-Chip Debugger|OpenOCD)\s+(\d+(?:\.\d+)+(?:[-+.\w]*)?)/i);
    return m ? m[1] : firstVersion(text);
  }
  if (tool === 'busybox') {
    m = text.match(/BusyBox\s+v?(\d+(?:\.\d+)+(?:[-+.\w]*)?)/i);
    return m ? m[1] : firstVersion(text);
  }
  return firstVersion(text);
}

function firstVersion(text) {
  const m = String(text || '').match(/\b\d+(?:\.\d+)+(?:[-+.\w]*)?\b/);
  return m ? m[0] : '';
}

function buildEnv(cfg) {
  const eff = effectivePaths(cfg);
  const pyDir = eff.pyocdPath ? path.dirname(eff.pyocdPath) : '';
  const ocdDir = eff.openocdPath ? path.dirname(eff.openocdPath) : '';
  const extra = [...toolsSearchDirs(), eff.armGccPath, eff.makePath, pyDir, ocdDir].filter(Boolean).join(PLATFORM_TC.pathDelimiter);
  return Object.assign({}, process.env, {
    PATH: extra ? `${extra}${PLATFORM_TC.pathDelimiter}${process.env.PATH}` : process.env.PATH
  });
}

function pathEntryKey(p) {
  let raw = String(p || '').trim().replace(/^"(.*)"$/, '$1');
  if (process.platform === 'win32') {
    raw = raw.replace(/%([^%]+)%/g, (_m, name) => process.env[name] || process.env[String(name).toUpperCase()] || _m);
  }
  const parsed = path.parse(raw);
  let n = path.resolve(raw);
  if (n !== parsed.root) n = n.replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? n.toLowerCase() : n;
}

function uniqueExistingDirs(dirs) {
  const out = [];
  const seen = new Set();
  for (const d of dirs || []) {
    if (!d || typeof d !== 'string') continue;
    const abs = path.resolve(d);
    if (!fs.existsSync(abs)) continue;
    try { if (!fs.statSync(abs).isDirectory()) continue; } catch { continue; }
    const key = pathEntryKey(abs);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(abs);
  }
  return out;
}

function collectToolchainPathDirs(status) {
  const st = status || defaultToolchainStatus();
  const dirs = [];
  if (st.gccBin) dirs.push(st.gccBin);
  if (st.makeBin && st.makeBin !== 'system') dirs.push(st.makeBin);
  if (st.openocdBin) dirs.push(path.dirname(st.openocdBin));
  if (st.pyocdBin) dirs.push(path.dirname(st.pyocdBin));
  for (const d of toolsSearchDirs()) dirs.push(d);
  for (const rootFn of [localStcgalRoot, localEsptoolRoot]) {
    try {
      const root = rootFn();
      dirs.push(process.platform === 'win32' ? path.join(root, 'Scripts') : path.join(root, 'bin'));
    } catch {}
  }
  return uniqueExistingDirs(dirs);
}

function readWindowsUserPath() {
  // reg query 比冷启动 PowerShell 更稳；未配置 Path 时按空串处理
  const r = spawnSync('reg', ['query', 'HKCU\\Environment', '/v', 'Path'], {
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true
  });
  if (r.error) throw new Error(r.error.message || 'read user PATH failed');
  if (r.status !== 0) {
    const err = String(r.stderr || r.stdout || '');
    if (/unable to find|找不到|ERROR:\s*The system was unable to find/i.test(err) || r.status === 1) return '';
    throw new Error(err.trim() || 'read user PATH failed');
  }
  const text = String(r.stdout || '');
  // 提示文字可能是本地代码页乱码，但键名和类型仍是 ASCII。
  const m = text.match(/^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*?)\s*$/mi);
  if (m) return m[1].trim();
  return '';
}

function writeWindowsUserPath(newPath) {
  const value = String(newPath || '');
  // 用 .reg 导入，避免 reg add /d 对超长 PATH / 引号 / 特殊字符报“无效参数”
  const escaped = value.split('\\').join('\\\\').split('"').join('\\"');
  const body = [
    'Windows Registry Editor Version 5.00',
    '',
    '[HKEY_CURRENT_USER\\Environment]',
    '"Path"="' + escaped + '"'
  ].join('\r\n') + '\r\n';
  const tmp = path.join(os.tmpdir(), 'burningtool-user-path-' + process.pid + '-' + Date.now() + '.reg');
  fs.writeFileSync(tmp, Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(body, 'utf16le')]));
  try {
    const r = spawnSync('reg', ['import', tmp], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    if (r.error || r.status !== 0) {
      const msg = r.error ? r.error.message : String(r.stderr || r.stdout || '').trim();
      throw new Error(msg || 'write user PATH failed');
    }
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
  // 不同步启动 PowerShell 广播，避免冷启动阻塞十几秒。
  // 新终端会读取注册表；软件子进程由 prependProcessPath 立即生效。
}

function mergePathEntries(existingPath, dirsToAdd, delimiter) {
  const parts = String(existingPath || '').split(delimiter).map((x) => x.trim()).filter(Boolean);
  const seen = new Set(parts.map(pathEntryKey));
  const added = [];
  for (const d of dirsToAdd) {
    const key = pathEntryKey(d);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(d);
  }
  // 保持传入顺序前置
  const next = added.concat(parts);
  return { path: next.join(delimiter), added, already: dirsToAdd.length - added.length };
}

function prependProcessPath(dirs) {
  if (!dirs || !dirs.length) return;
  const delim = PLATFORM_TC.pathDelimiter || path.delimiter;
  const cur = String(process.env.PATH || '');
  process.env.PATH = mergePathEntries(cur, dirs, delim).path;
}

function getSystemPathStatus(status) {
  const dirs = collectToolchainPathDirs(status);
  if (process.platform !== 'win32') {
    return {
      ok: true,
      supported: false,
      present: false,
      dirs,
      matched: [],
      missing: dirs.slice(),
      scope: 'unsupported',
      message: '仅 Windows 支持写入用户 PATH'
    };
  }
  try {
    const userPath = readWindowsUserPath();
    const parts = String(userPath || '').split(';').map((x) => x.trim()).filter(Boolean);
    const seen = new Set(parts.map(pathEntryKey));
    const matched = [];
    const missing = [];
    for (const d of dirs) {
      if (seen.has(pathEntryKey(d))) matched.push(d);
      else missing.push(d);
    }
    return {
      ok: true,
      supported: true,
      present: dirs.length > 0 && missing.length === 0,
      partial: matched.length > 0 && missing.length > 0,
      dirs,
      matched,
      missing,
      scope: 'user'
    };
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    return { ok: false, supported: true, present: false, dirs, matched: [], missing: dirs.slice(), error: msg, scope: 'user' };
  }
}

function syncSystemPath(status) {
  const dirs = collectToolchainPathDirs(status);
  if (!dirs.length) return { ok: false, added: [], dirs: [], message: 'no toolchain dirs' };
  // 本进程始终可注入，保证软件内编译烧录立即可用
  prependProcessPath(dirs);
  if (process.platform === 'win32') {
    try {
      const userPath = readWindowsUserPath();
      const merged = mergePathEntries(userPath, dirs, ';');
      if (merged.added.length) {
        writeWindowsUserPath(merged.path);
        bus.send('[环境] 已写入用户 PATH（新增 ' + merged.added.length + ' 项）', 'success');
        for (const d of merged.added) bus.send('[环境] PATH += ' + d, 'info');
        bus.send('[环境] 已打开的终端需重开后才能使用新 PATH', 'info');
      } else {
        bus.send('[环境] 工具链目录已在用户 PATH 中，无需重复添加', 'info');
      }
      return { ok: true, added: merged.added, dirs, already: merged.already, scope: 'user', present: true };
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      bus.send('[环境] 写入系统 PATH 失败: ' + msg, 'error');
      bus.send('[环境] 当前进程 PATH 已临时注入，仅对本软件子进程生效', 'info');
      return { ok: false, added: [], dirs, error: msg, scope: 'process-only', present: false };
    }
  }
  bus.send('[环境] 已注入本进程 PATH（' + dirs.length + ' 项）；mac/Linux 未改写 shell 配置', 'info');
  for (const d of dirs) bus.send('[环境] PATH += ' + d, 'info');
  return { ok: true, added: dirs, dirs, scope: 'process-only', present: false, supported: false };
}

function removeSystemPath(status) {
  const dirs = collectToolchainPathDirs(status);
  if (!dirs.length) return { ok: false, removed: [], dirs: [], message: 'no toolchain dirs' };
  if (process.platform !== 'win32') {
    return { ok: false, removed: [], dirs, supported: false, message: '仅 Windows 支持删除用户 PATH' };
  }
  try {
    const userPath = readWindowsUserPath();
    const parts = String(userPath || '').split(';').map((x) => x.trim()).filter(Boolean);
    const drop = new Set(dirs.map(pathEntryKey));
    const kept = [];
    const removed = [];
    for (const pth of parts) {
      if (drop.has(pathEntryKey(pth))) removed.push(pth);
      else kept.push(pth);
    }
    if (!removed.length) {
      bus.send('[环境] 用户 PATH 中未找到工具链目录，无需删除', 'info');
      return { ok: true, removed: [], dirs, present: false, scope: 'user' };
    }
    writeWindowsUserPath(kept.join(';'));
    bus.send('[环境] 已从用户 PATH 删除 ' + removed.length + ' 项', 'success');
    for (const d of removed) bus.send('[环境] PATH -= ' + d, 'info');
    bus.send('[环境] 已打开的终端需重开后生效', 'info');
    return { ok: true, removed, dirs, present: false, scope: 'user' };
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    bus.send('[环境] 删除系统 PATH 失败: ' + msg, 'error');
    return { ok: false, removed: [], dirs, error: msg, scope: 'user' };
  }
}

function findExecutableOnPath(name) {
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function homeDir() {
  // Windows 没有 HOME，只有 USERPROFILE；os.homedir() 三平台都可靠，作为兜底
  return process.env.HOME || process.env.USERPROFILE || os.homedir() || '';
}

function expandHomePath(p) {
  if (typeof p !== 'string') return p;
  const home = homeDir();
  if (p === '~') return home || p;
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(home || '~', p.slice(2));
  return p;
}

// 判断字符串是否带路径分隔符（跨平台：同时识别 / 与 \），用于区分「裸命令(交给 PATH)」与「具体路径」。
// 不能只用 path.sep：Windows 上 path.sep 为 '\'，会把 /usr/local/bin/xxx 误判为裸命令。
function looksLikePath(p) {
  return typeof p === 'string' && /[\\/]/.test(p);
}

function pythonCandidates() {
  return process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
}

async function findPythonCommand() {
  for (const cmd of pythonCandidates()) {
    const code = await runProcess(cmd, ['--version'], { shell: false });
    if (code === 0) return cmd;
  }
  return '';
}

function resolvePyocdPath(cfg) {
  const isWin = process.platform === 'win32';
  const original = effectivePaths(cfg).pyocdPath;
  let pyocd = expandHomePath(original);
  // 跨机器/跨平台同步配置时，配置里可能残留「非本平台」的绝对路径，先清掉再回退默认/系统查找
  const isForeignWindowsPath = !isWin && /^[a-z]:[\\/]/i.test(pyocd || '');
  const isForeignPosixPath = isWin && /^\//.test(pyocd || '');
  const switchedAway = isForeignWindowsPath || isForeignPosixPath;
  if (switchedAway) pyocd = '';

  // POSIX 专属回退路径只在非 Windows 上参与候选，避免在 Windows 上被误当裸命令执行
  const posixFallbacks = isWin ? [] : [
    '/opt/homebrew/bin/pyocd',
    '/usr/local/bin/pyocd',
    path.join(homeDir(), '.local/bin/pyocd')
  ];
  const candidates = [
    localPyocdBin(),
    pyocd,
    expandHomePath(PLATFORM_TC.placeholders.pyocdPath),
    ...posixFallbacks,
    findExecutableOnPath(isWin ? 'pyocd.exe' : 'pyocd')
  ].filter(Boolean);

  for (const p of candidates) {
    if (!looksLikePath(p) || fs.existsSync(p)) {
      return { pyocd: p, switched: switchedAway && p !== original };
    }
  }
  return { pyocd: candidates[0] || '', switched: switchedAway };
}

function resolveOpenocdPath(cfg) {
  const isWin = process.platform === 'win32';
  const original = effectivePaths(cfg).openocdPath || cfg.openocdPath || '';
  let openocd = expandHomePath(original);
  const isForeignWindowsPath = !isWin && /^[a-z]:[\\/]/i.test(openocd || '');
  const isForeignPosixPath = isWin && /^\//.test(openocd || '');
  const switchedAway = isForeignWindowsPath || isForeignPosixPath;
  if (switchedAway) openocd = '';
  const posixFallbacks = isWin ? [] : [
    '/opt/homebrew/bin/openocd',
    '/usr/local/bin/openocd',
    '/usr/bin/openocd'
  ];
  const candidates = [
    localOpenocdBin(),
    openocd,
    expandHomePath(PLATFORM_TC.placeholders.openocdPath),
    ...posixFallbacks,
    findExecutableOnPath(isWin ? 'openocd.exe' : 'openocd')
  ].filter(Boolean);
  for (const p of candidates) {
    if (!looksLikePath(p) || fs.existsSync(p)) return { openocd: p, switched: switchedAway && p !== original };
  }
  return { openocd: candidates[0] || '', switched: switchedAway };
}

async function installToolchain(cfg = {}) {
  if (PLATFORM_TC.commandTools.mode !== 'busybox') {
    bus.send(`[环境] ${PLATFORM_TC.label} 使用系统自带命令（rm/mkdir/sh 等），无需额外安装`, 'info');
    return { installed: true, mode: 'system', dir: PLATFORM_TC.commandTools.pathDisplay, count: 0 };
  }
  const dir = toolsDir();
  fs.mkdirSync(dir, { recursive: true });
  const bb = path.join(dir, 'busybox.exe');

  if (!fs.existsSync(bb) || fs.statSync(bb).size < 100000) {
    bus.send('[环境] 正在下载 busybox（约 660KB）...', 'step');
    bus.send(`[环境] 下载文件: ${PLATFORM_TC.commandTools.url}`, 'info');
    bus.send(`[环境] 保存路径: ${bb}`, 'info');
    await downloadFast(applyMirror(PLATFORM_TC.commandTools.url, cfg), bb);
    bus.send(`[环境] ✓ busybox 已下载 (${(fs.statSync(bb).size / 1024) | 0} KB)`, 'success');
  } else {
    bus.send('[环境] busybox 已存在，跳过下载', 'info');
  }

  let created = 0;
  for (const name of APPLETS) {
    const p = path.join(dir, name + '.exe');
    if (!fs.existsSync(p)) { fs.copyFileSync(bb, p); created++; }
  }
  bus.send(`[环境] ✓ 编译环境就绪：${APPLETS.length} 个命令（新建 ${created} 个）`, 'success');
  bus.send(`[环境] 目录: ${dir}`, 'info');
  return { installed: true, dir, count: APPLETS.length };
}

async function installLocalPyocd(force = false) {
  const bin = localPyocdBin();
  if (!force && fs.existsSync(bin)) {
    bus.send(`[环境] ✓ pyOCD 已存在，跳过安装: ${bin}`, 'info');
    return true;
  }
  const python = await findPythonCommand();
  if (!python) {
    bus.send('[环境] ✗ 未找到 Python，无法创建本地 pyOCD', 'error');
    bus.send('[环境] 请先安装 Python 3，然后重新安装默认工具链', 'info');
    return false;
  }
  const root = localPyocdRoot();
  try { if (force) fs.rmSync(root, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(toolchainRoot(), { recursive: true });
  bus.send('[环境] 正在创建本地 pyOCD 环境...', 'step');
  bus.send(`[系统] 当前系统: ${systemLogLabel()}`, 'info');
  bus.send(`[环境] 识别系统: ${PLATFORM_TC.label} (${process.platform}/${process.arch})`, 'info');
  bus.send(`[环境] Python: ${python}`, 'info');
  bus.send(`[环境] pyOCD 目录: ${root}`, 'info');
  bus.send(`[环境] pyOCD 路径: ${bin}`, 'info');
  let code = fs.existsSync(root) ? 0 : await runProcess(python, ['-m', 'venv', root], { shell: false });
  if (code !== 0) {
    bus.send(`[环境] ✗ 创建 pyOCD 虚拟环境失败 (exit ${code})`, 'error');
    return false;
  }
  const pip = process.platform === 'win32' ? path.join(root, 'Scripts', 'python.exe') : path.join(root, 'bin', 'python');
  code = await runProcess(pip, ['-m', 'pip', 'install', '-U', 'pip', 'pyocd'], { shell: false });
  if (code !== 0) {
    bus.send(`[环境] ✗ 安装 pyOCD 失败 (exit ${code})`, 'error');
    bus.send('[环境] 可检查网络或 pip 源；本地目录保留在 toolchain/pyocd/', 'info');
    return false;
  }
  bus.send(`[环境] ✓ pyOCD 已安装到默认工具链目录: ${bin}`, 'success');
  return fs.existsSync(bin);
}

async function installLocalStcgal(force = false) {
  const bin = localStcgalBin();
  if (!force && fs.existsSync(bin)) {
    bus.send(`[环境] ✓ stcgal 已存在，跳过安装: ${bin}`, 'info');
    return { ok: true, bin };
  }
  const python = await findPythonCommand();
  if (!python) {
    bus.send('[环境] ✗ 未找到 Python，无法创建本地 stcgal', 'error');
    bus.send('[环境] 请先安装 Python 3，然后重新安装 stcgal', 'info');
    return { ok: false, error: '未找到 Python' };
  }
  const root = localStcgalRoot();
  try { if (force) fs.rmSync(root, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(toolchainRoot(), { recursive: true });
  bus.send('[环境] 正在创建本地 stcgal 环境...', 'step');
  bus.send(`[系统] 当前系统: ${systemLogLabel()}`, 'info');
  bus.send(`[环境] 识别系统: ${PLATFORM_TC.label} (${process.platform}/${process.arch})`, 'info');
  bus.send(`[环境] Python: ${python}`, 'info');
  bus.send(`[环境] stcgal 目录: ${root}`, 'info');
  bus.send(`[环境] stcgal 路径: ${bin}`, 'info');
  let code = fs.existsSync(root) ? 0 : await runProcess(python, ['-m', 'venv', root], { shell: false });
  if (code !== 0) {
    bus.send(`[环境] ✗ 创建 stcgal 虚拟环境失败 (exit ${code})`, 'error');
    return { ok: false, error: 'venv creation failed' };
  }
  const pip = process.platform === 'win32' ? path.join(root, 'Scripts', 'python.exe') : path.join(root, 'bin', 'python');
  code = await runProcess(pip, ['-m', 'pip', 'install', '-U', 'pip', 'stcgal'], { shell: false });
  if (code !== 0) {
    bus.send(`[环境] ✗ 安装 stcgal 失败 (exit ${code})`, 'error');
    bus.send('[环境] 可检查网络或 pip 源；本地目录保留在 toolchain/stcgal/', 'info');
    return { ok: false, error: 'pip install failed' };
  }
  bus.send(`[环境] ✓ stcgal 已安装到默认工具链目录: ${bin}`, 'success');
  return { ok: fs.existsSync(bin), bin };
}

async function installLocalEsptool(force = false) {
  const bin = localEsptoolBin();
  if (!force && fs.existsSync(bin)) {
    bus.send(`[环境] ✓ esptool 已存在，跳过安装: ${bin}`, 'info');
    return { ok: true, bin };
  }
  const python = await findPythonCommand();
  if (!python) {
    bus.send('[环境] ✗ 未找到 Python，无法创建本地 esptool', 'error');
    bus.send('[环境] 请先安装 Python 3，然后重新安装 esptool', 'info');
    return { ok: false, error: '未找到 Python' };
  }
  const root = localEsptoolRoot();
  try { if (force) fs.rmSync(root, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(toolchainRoot(), { recursive: true });
  bus.send('[环境] 正在创建本地 esptool 环境...', 'step');
  bus.send(`[系统] 当前系统: ${systemLogLabel()}`, 'info');
  bus.send(`[环境] 识别系统: ${PLATFORM_TC.label} (${process.platform}/${process.arch})`, 'info');
  bus.send(`[环境] Python: ${python}`, 'info');
  bus.send(`[环境] esptool 目录: ${root}`, 'info');
  bus.send(`[环境] esptool 路径: ${bin}`, 'info');
  let code = fs.existsSync(root) ? 0 : await runProcess(python, ['-m', 'venv', root], { shell: false });
  if (code !== 0) {
    bus.send(`[环境] ✗ 创建 esptool 虚拟环境失败 (exit ${code})`, 'error');
    return { ok: false, error: 'venv creation failed' };
  }
  const pip = process.platform === 'win32' ? path.join(root, 'Scripts', 'python.exe') : path.join(root, 'bin', 'python');
  code = await runProcess(pip, ['-m', 'pip', 'install', '-U', 'pip', 'esptool'], { shell: false });
  if (code !== 0) {
    bus.send(`[环境] ✗ 安装 esptool 失败 (exit ${code})`, 'error');
    bus.send('[环境] 可检查网络或 pip 源；本地目录保留在 toolchain/esptool/', 'info');
    return { ok: false, error: 'pip install failed' };
  }
  bus.send(`[环境] ✓ esptool 已安装到默认工具链目录: ${bin}`, 'success');
  return { ok: fs.existsSync(bin), bin };
}

/* ── 默认工具链：下载 + 解压到可写 toolchain/ ────── */
async function downloadAndExtract(spec, label, destDir, cfg) {
  if (!spec || spec.mode !== 'download' || !spec.url) return false;
  if (process.platform !== 'win32' && spec.archiveType === 'zip') {
    bus.send(`[环境] ✗ 平台匹配错误：${PLATFORM_TC.label} 不应下载 ${label} 的 Windows zip 包`, 'error');
    bus.send(`[环境] 当前系统: ${process.platform}/${process.arch}`, 'error');
    bus.send(`[环境] 错误地址: ${spec.url || '无'}`, 'error');
    return false;
  }
  fs.mkdirSync(toolchainRoot(), { recursive: true });
  const archiveExt = spec.archiveType === 'tar.gz' ? '.tar.gz' : '.zip';
  const archiveName = spec.fileName || (label + archiveExt);
  const archive = path.join(toolchainRoot(), archiveName);
  const downloadUrl = applyMirror(spec.url, cfg);
  bus.send(`[环境] 正在下载 ${label}（8 线程加速）...`, 'step');
  bus.send(`[系统] 当前系统: ${systemLogLabel()}`, 'info');
  bus.send(`[环境] 识别系统: ${PLATFORM_TC.label} (${process.platform}/${process.arch})`, 'info');
  bus.send(`[环境] 匹配包: ${archiveName}`, 'info');
  bus.send(`[环境] 原始地址: ${spec.url}`, 'info');
  if (downloadUrl !== spec.url) bus.send(`[环境] 实际地址: ${downloadUrl}`, 'info');
  bus.send(`[环境] 保存路径: ${archive}`, 'info');
  bus.send(`[环境] 解压目录: ${destDir}`, 'info');
  bus.send(`[环境] 手动下载: 如自动下载失败，可下载上面的原始地址，并将文件放到保存路径后重试`, 'info');
  let lastPct = -1, lastT = 0;
  const existingMb = fs.existsSync(archive) ? ((fs.statSync(archive).size / 1048576) | 0) : 0;
  if (existingMb >= 10) {
    bus.send(`[环境] 检测到本地安装包 (${existingMb} MB)，跳过下载直接解压`, 'info');
  } else {
    try {
      await downloadFast(downloadUrl, archive, (received, total) => {
        const t = Date.now();
        const rmb = (received / 1048576).toFixed(1);
        if (total > 0) {
          const pct = Math.floor(received * 100 / total);
          if (pct !== lastPct && (pct >= 100 || t - lastT > 250)) {
            lastPct = pct; lastT = t;
            const tmb = (total / 1048576).toFixed(1);
            bus.sendProgress(`dl-${label}`, `[环境] 下载 ${label}: ${pct}%  (${rmb}/${tmb} MB)`);
            bus.sendDownloadProgress(label, pct);
          }
        } else if (t - lastT > 400) {
          lastT = t;
          bus.sendProgress(`dl-${label}`, `[环境] 下载 ${label}: ${rmb} MB`);
          bus.sendDownloadProgress(label, -1);
        }
      });
    } catch (e) {
      const msg = e && (e.code || e.message) ? `${e.code ? e.code + ': ' : ''}${e.message || ''}` : String(e);
      bus.send(`[环境] ✗ ${label} 下载失败: ${msg}`, 'error');
      bus.send(`[环境] 识别系统: ${PLATFORM_TC.label} (${process.platform}/${process.arch})`, 'error');
      bus.send(`[环境] 匹配包: ${archiveName}`, 'error');
      bus.send(`[环境] 原始地址: ${spec.url}`, 'error');
      if (downloadUrl !== spec.url) bus.send(`[环境] 实际地址: ${downloadUrl}`, 'error');
      bus.send(`[环境] 本地路径: ${archive}`, 'error');
      bus.send(`[环境] 手动处理: 下载原始地址对应文件，复制到本地路径，再点「下载缺失的工具链」重试`, 'info');
      try { fs.unlinkSync(archive); } catch {}
      throw e;
    }
  }
  const mb = (fs.statSync(archive).size / 1048576) | 0;
  bus.send(`[环境] ✓ ${label} 下载完成 (${mb} MB)，正在解压 ...`, 'info');
  try { fs.rmSync(destDir, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(destDir, { recursive: true });
  let code;
  if (spec.archiveType === 'tar.gz') {
    code = await runProcess('tar', ['-xzf', archive, '-C', destDir], { shell: false });
  } else {
    code = await runProcess(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
       `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${destDir}' -Force`],
      { shell: false }
    );
  }
  if (code !== 0) {
    bus.send(`[环境] ✗ ${label} 解压失败 (exit ${code})`, 'error');
    return false;
  }
  try { fs.unlinkSync(archive); } catch {}
  bus.send(`[环境] ✓ ${label} 解压完成`, 'success');
  return true;
}

async function installDefaultToolchain(cfg = {}, opts = {}) {
  const force = !!opts.force; // 强制重装时即使已存在也重新下载
  migrateLegacyToolchainIfNeeded();
  const plan = getToolchainDownloadPlan(PLATFORM_TC, cfg.toolchainMode || 'custom');
  if (plan.mode !== 'default') {
    bus.send('[环境] 当前为自定义路径模式，不执行默认工具链下载', 'info');
    bus.send(`[环境] ARM GCC bin: ${cfg.armGccPath || '未配置'}`, cfg.armGccPath ? 'info' : 'error');
    bus.send(`[环境] make bin: ${cfg.makePath || '未配置'}`, cfg.makePath ? 'info' : 'error');
    bus.send('[环境] 如需自动下载，请先切换为「使用默认(自动下载)」并保存设置', 'info');
    return Object.assign({ ok: false, skipped: true, reason: 'custom-paths' }, defaultToolchainStatus());
  }
  const root = toolchainRoot();
  fs.mkdirSync(root, { recursive: true });
  bus.send('[环境] ═══ 安装默认工具链到可写目录 toolchain/ ═══', 'step');
  bus.send(`[系统] 当前系统: ${systemLogLabel()}`, 'info');
  bus.send(`[环境] 识别系统: ${PLATFORM_TC.label} (${process.platform}/${process.arch})`, 'info');
  bus.send(`[环境] 工具链目录: ${root}`, 'info');
  bus.send(`[环境] 下载计划: ${plan.downloads.map((x) => x.key).join(', ') || '无下载项'}`, 'info');
  bus.send(`[环境] 系统提供: ${plan.system.map((x) => x.key).join(', ') || '无'}`, 'info');
  if ((cfg.ghProxy || '').trim()) bus.send(`[环境] 使用下载镜像: ${cfg.ghProxy.trim()}`, 'info');

  const before = defaultToolchainStatus();
  let okGcc = !!before.gccBin, okMake = !!before.makeBin, okPyocd = !!before.pyocdBin, okOpenocd = !!before.openocdBin;
  try {
    // 编译命令(busybox)：仅缺失或强制时安装
    const commandTask = plan.downloads.find((x) => x.key === 'commandTools');
    if (commandTask) {
      if (force || !before.busybox) await installToolchain(cfg);
      else bus.send('[环境] ✓ 编译命令(rm/mkdir 等)已存在，跳过', 'info');
    } else {
      const cmdSys = plan.system.find((x) => x.key === 'commandTools');
      if (cmdSys) bus.send(`[环境] ${PLATFORM_TC.label} 使用系统自带命令: ${cmdSys.spec.pathDisplay}`, 'info');
    }

    // ARM GCC：已存在则跳过，避免重复下载 150MB
    const gccTask = plan.downloads.find((x) => x.key === 'gcc');
    if (!gccTask) {
      okGcc = true;
    } else if (!force && before.gccBin) {
      bus.send(`[环境] ✓ ARM GCC 已存在，跳过下载: ${before.gccBin}`, 'info');
    } else {
      okGcc = await downloadAndExtract(gccTask.spec, gccTask.label, path.join(root, 'gcc'), cfg);
    }

    // make：Windows 下载，mac/Linux 使用系统自带
    const makeTask = plan.downloads.find((x) => x.key === 'make');
    if (makeTask) {
      if (!force && before.makeBin && before.makeBin !== 'system') {
        bus.send(`[环境] ✓ make 已存在，跳过下载: ${before.makeBin}`, 'info');
      } else {
        okMake = await downloadAndExtract(makeTask.spec, makeTask.label, path.join(root, 'make'), cfg);
      }
    } else {
      okMake = true;
      const makeSys = plan.system.find((x) => x.key === 'make');
      if (makeSys) bus.send(`[环境] ${PLATFORM_TC.label} 使用系统自带 make: ${makeSys.spec.pathDisplay}`, 'info');
    }

    const pyocdTask = plan.downloads.find((x) => x.key === 'pyocd');
    if (pyocdTask) okPyocd = await installLocalPyocd(force);
    else okPyocd = true;

    const openocdTask = plan.downloads.find((x) => x.key === 'openocd');
    if (openocdTask) {
      if (!force && before.openocdBin) {
        bus.send(`[环境] ✓ OpenOCD 已存在，跳过下载: ${before.openocdBin}`, 'info');
      } else {
        okOpenocd = await downloadAndExtract(openocdTask.spec, openocdTask.label, path.join(root, 'openocd'), cfg);
      }
    } else {
      okOpenocd = true;
    }
  } finally {
    bus.sendDownloadProgress('', 100); // 收尾：通知渲染端结束进度
  }

  const st = defaultToolchainStatus();
  bus.send(`[环境] ARM GCC bin: ${st.gccBin || '未找到'}`, st.gccBin ? 'info' : 'error');
  bus.send(`[环境] make: ${st.makeBin === 'system' ? PLATFORM_TC.defaultDownloads.make.pathDisplay : (st.makeBin || '未找到')}`,
    st.makeBin ? 'info' : 'error');
  bus.send(`[环境] pyOCD: ${st.pyocdBin || '未找到'}`, st.pyocdBin ? 'info' : 'error');
  bus.send(`[环境] OpenOCD: ${st.openocdBin || '未找到'}`, st.openocdBin ? 'info' : 'error');
  const ok = !!(st.gccBin && st.makeBin && st.pyocdBin && st.openocdBin);
  bus.send(ok ? '[环境] ✓ 默认工具链已就绪（pyOCD/OpenOCD 使用默认工具链目录 toolchain/）'
          : '[环境] ✗ 默认工具链未完全就绪，请查看上面日志', ok ? 'success' : 'error');
  // 系统 PATH 改为手动设置/删除，不再安装后自动写入
  return Object.assign({ ok }, st);
}

module.exports = {
  APPLETS,
  readHostSystemInfo,
  systemLogLabel,
  toolsDir,
  toolsSearchDirs,
  isToolchainInstalled,
  toolchainRoot,
  preferredToolchainRoot,
  legacyToolchainRoot,
  toolchainSearchRoots,
  migrateLegacyToolchainIfNeeded,
  localPyocdRoot,
  localPyocdBin,
  localStcgalRoot,
  localStcgalBin,
  localStcgalPython,
  localEsptoolRoot,
  localEsptoolBin,
  localEsptoolPython,
  findExeDir,
  effectivePaths,
  defaultToolchainStatus,
  buildEnv,
  findExecutableOnPath,
  expandHomePath,
  pythonCandidates,
  findPythonCommand,
  resolvePyocdPath,
  resolveOpenocdPath,
  parseToolVersion,
  supportedCommandTools,
  installToolchain,
  installLocalPyocd,
  installLocalStcgal,
  installLocalEsptool,
  downloadAndExtract,
  installDefaultToolchain,
  collectToolchainPathDirs,
  mergePathEntries,
  readWindowsUserPath,
  writeWindowsUserPath,
  syncSystemPath,
  getSystemPathStatus,
  removeSystemPath
};
