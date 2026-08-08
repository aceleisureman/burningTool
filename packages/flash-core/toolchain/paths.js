// 工具链根目录、可执行文件定位与跨平台路径解析。
const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { PLATFORM_TC, loadConfig } = require('../core/env');
const bus = require('../core/bus');
const { getPathsContext } = require('../core/paths-context');
const { runProcess } = require('./proc');

/**
 * 用系统命令查找可执行文件（避免 PATH 含网络路径时 fs.existsSync 阻塞）
 * @param {string} name - 可执行文件名
 * @param {number} timeoutMs - 超时毫秒（默认 4000）
 * @returns {string|null} 找到的完整路径，否则 null
 */
function whichSync(name, timeoutMs = 4000) {
  const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    const out = execFileSync(cmd, [name], {
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const first = (out || '').split(/\r?\n/).find((l) => l.trim());
    if (first) return first.trim();
  } catch { /* not found or timeout */ }
  return null;
}

function toolsDir() {
  const ctx = getPathsContext();
  return ctx.toolsDir || path.join(ctx.userDataDir, 'tools');
}

function toolsSearchDirs() {
  return PLATFORM_TC.commandTools.mode === 'busybox'
    ? [path.join(appInstallRoot(), 'resources', 'tools'), toolsDir()]
    : [];
}

function isToolchainInstalled() {
  if (PLATFORM_TC.commandTools.mode !== 'busybox') return true;
  return toolsSearchDirs().some((d) => fs.existsSync(path.join(d, 'rm.exe')));
}

function appInstallRoot() {
  const ctx = getPathsContext();
  if (ctx.isPackaged || String(__dirname).includes('app.asar')) {
    return ctx.appInstallRoot || ctx.userDataDir;
  }
  // flash-core 位于 packages/flash-core/toolchain → 仓库根为 ../../..
  return ctx.appInstallRoot || path.join(__dirname, '..', '..', '..');
}

function preferredToolchainRoot(cfg) {
  // 优先使用调用方传入的 cfg.toolchainRootPath；
  // 未传 cfg 时再 loadConfig；都空则：paths-context.toolchainRoot → packaged userData/toolchain → 仓库 toolchain/
  let custom = '';
  try {
    if (cfg && typeof cfg === 'object') {
      custom = expandHomePath(String(cfg.toolchainRootPath || '').trim());
    } else {
      const c = loadConfig() || {};
      custom = expandHomePath(String(c.toolchainRootPath || '').trim());
    }
  } catch {}
  if (custom) return path.resolve(custom);
  const ctx = getPathsContext();
  if (ctx.toolchainRoot) return path.resolve(ctx.toolchainRoot);
  if (ctx.isPackaged || String(__dirname).includes('app.asar')) {
    return path.join(ctx.userDataDir, 'toolchain');
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
    whichSync(isWin ? 'pyocd.exe' : 'pyocd') || ''
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
    whichSync(isWin ? 'openocd.exe' : 'openocd') || ''
  ].filter(Boolean);
  for (const p of candidates) {
    if (!looksLikePath(p) || fs.existsSync(p)) return { openocd: p, switched: switchedAway && p !== original };
  }
  return { openocd: candidates[0] || '', switched: switchedAway };
}

module.exports = {
  toolsDir,
  toolsSearchDirs,
  isToolchainInstalled,
  appInstallRoot,
  preferredToolchainRoot,
  legacyToolchainRoot,
  toolchainSearchRoots,
  toolchainRoot,
  migrateLegacyToolchainIfNeeded,
  localPyocdRoot,
  localPyocdBin,
  localStcgalRoot,
  localStcgalPython,
  localStcgalBin,
  localEsptoolRoot,
  localEsptoolPython,
  localEsptoolBin,
  localOpenocdRoot,
  localOpenocdBin,
  findExeDir,
  effectivePaths,
  findExecutableOnPath,
  expandHomePath,
  pythonCandidates,
  findPythonCommand,
  resolvePyocdPath,
  resolveOpenocdPath
};
