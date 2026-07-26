// 工具链目录收集，以及 Windows 用户 PATH / macOS、Linux shell PATH 的管理。
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { PLATFORM_TC } = require('../core/config');
const bus = require('../core/bus');
const { defaultToolchainStatus } = require('./status');
const { toolsSearchDirs, localStcgalRoot, localEsptoolRoot } = require('./paths');

const SHELL_PATH_BEGIN = '# >>> burningTool toolchain PATH >>>';
const SHELL_PATH_END = '# <<< burningTool toolchain PATH <<<';
const SHELL_PATH_BLOCK_RE = new RegExp(
  '^' + SHELL_PATH_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\r?\\n[\\s\\S]*?^' +
  SHELL_PATH_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\r?\\n)?',
  'gm'
);

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

function resolveShellProfile(platform, shell, home) {
  const base = home || os.homedir();
  const shellName = path.basename(String(shell || '')).toLowerCase();
  if (platform === 'darwin') {
    if (shellName === 'zsh') return path.join(base, '.zprofile');
    if (shellName === 'bash') return path.join(base, '.bash_profile');
    return path.join(base, '.profile');
  }
  if (platform === 'linux') {
    if (shellName === 'zsh') return path.join(base, '.zshrc');
    if (shellName === 'bash') return path.join(base, '.bashrc');
    return path.join(base, '.profile');
  }
  return '';
}

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\"'\"'") + "'";
}

function managedShellPathBlock(dirs) {
  const lines = [SHELL_PATH_BEGIN];
  for (const dir of dirs || []) lines.push('export PATH=' + shellQuote(dir) + ':"$PATH"');
  lines.push(SHELL_PATH_END);
  return lines.join('\n') + '\n';
}

function removeManagedShellPath(content) {
  return String(content || '').replace(SHELL_PATH_BLOCK_RE, '');
}

function updateManagedShellPath(content, dirs) {
  const base = removeManagedShellPath(content);
  const separator = base && !base.endsWith('\n') ? '\n' : '';
  return base + separator + managedShellPathBlock(dirs);
}

function inspectManagedShellPath(content, dirs) {
  const source = String(content || '');
  const block = source.match(SHELL_PATH_BLOCK_RE);
  const managed = block ? block[0] : '';
  const matched = [];
  const missing = [];
  for (const dir of dirs || []) {
    const line = 'export PATH=' + shellQuote(dir) + ':"$PATH"';
    if (managed.split(/\r?\n/).includes(line)) matched.push(dir);
    else missing.push(dir);
  }
  return { matched, missing };
}

function shellPathMeta(runtime) {
  const platform = runtime.platform;
  const shellName = path.basename(String(runtime.shell || '')).toLowerCase() || 'shell';
  const systemName = platform === 'darwin' ? 'macOS' : 'Linux';
  const profile = resolveShellProfile(platform, runtime.shell, runtime.home);
  return { profile, shellName, label: systemName + ' ' + shellName + ' PATH' };
}

function getShellPathStatus(dirs, runtime = {}) {
  const current = {
    platform: runtime.platform || process.platform,
    shell: runtime.shell || process.env.SHELL || '',
    home: runtime.home || os.homedir()
  };
  if (current.platform !== 'darwin' && current.platform !== 'linux') {
    return {
      ok: true, supported: false, present: false, partial: false,
      dirs, matched: [], missing: (dirs || []).slice(), scope: 'unsupported',
      message: '当前系统不支持自动写入 PATH'
    };
  }
  const meta = shellPathMeta(current);
  try {
    const content = fs.existsSync(meta.profile) ? fs.readFileSync(meta.profile, 'utf8') : '';
    const inspected = inspectManagedShellPath(content, dirs);
    const present = dirs.length > 0 && inspected.missing.length === 0;
    const partial = inspected.matched.length > 0 && inspected.missing.length > 0;
    return {
      ok: true, supported: true, present, partial, dirs,
      matched: inspected.matched, missing: inspected.missing,
      scope: 'shell-profile', profile: meta.profile, shell: meta.shellName, label: meta.label,
      message: present
        ? '工具链 PATH 已写入 ' + meta.profile
        : (partial ? '部分工具链 PATH 已写入 ' + meta.profile : '可写入 ' + meta.profile + '，新终端生效')
    };
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    return {
      ok: false, supported: true, present: false, partial: false, dirs,
      matched: [], missing: dirs.slice(), scope: 'shell-profile', profile: meta.profile,
      shell: meta.shellName, label: meta.label, error: msg, message: msg
    };
  }
}

function getSystemPathStatus(status) {
  const dirs = collectToolchainPathDirs(status);
  if (process.platform === 'darwin' || process.platform === 'linux') {
    return getShellPathStatus(dirs);
  }
  if (process.platform !== 'win32') {
    return {
      ok: true,
      supported: false,
      present: false,
      dirs,
      matched: [],
      missing: dirs.slice(),
      scope: 'unsupported',
      label: '系统 PATH',
      message: '当前系统不支持自动写入 PATH'
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
      scope: 'user',
      label: 'Windows 用户 PATH',
      message: missing.length === 0 && dirs.length > 0 ? '工具链目录已写入 Windows 用户 PATH' : '可写入 Windows 用户 PATH，新终端生效'
    };
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    return { ok: false, supported: true, present: false, dirs, matched: [], missing: dirs.slice(), error: msg, message: msg, scope: 'user', label: 'Windows 用户 PATH' };
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
  if (process.platform === 'darwin' || process.platform === 'linux') {
    const runtime = { platform: process.platform, shell: process.env.SHELL || '', home: os.homedir() };
    const meta = shellPathMeta(runtime);
    try {
      const content = fs.existsSync(meta.profile) ? fs.readFileSync(meta.profile, 'utf8') : '';
      const before = inspectManagedShellPath(content, dirs);
      fs.mkdirSync(path.dirname(meta.profile), { recursive: true });
      fs.writeFileSync(meta.profile, updateManagedShellPath(content, dirs), 'utf8');
      bus.send('[环境] 已写入 ' + meta.label + '：' + meta.profile, 'success');
      for (const d of before.missing) bus.send('[环境] PATH += ' + d, 'info');
      bus.send('[环境] 新终端打开后生效', 'info');
      return {
        ok: true, supported: true, added: before.missing, dirs,
        already: before.matched.length, scope: 'shell-profile', profile: meta.profile,
        shell: meta.shellName, label: meta.label, present: true
      };
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      bus.send('[环境] 写入 shell PATH 失败: ' + msg, 'error');
      bus.send('[环境] 当前进程 PATH 已临时注入，仅对本软件子进程生效', 'info');
      return { ok: false, supported: true, added: [], dirs, error: msg, message: msg, scope: 'process-only', profile: meta.profile, label: meta.label, present: false };
    }
  }
  return { ok: false, supported: false, added: [], dirs, message: '当前系统不支持自动写入 PATH', scope: 'unsupported', present: false };
}

function removeSystemPath(status) {
  const dirs = collectToolchainPathDirs(status);
  if (process.platform === 'darwin' || process.platform === 'linux') {
    const runtime = { platform: process.platform, shell: process.env.SHELL || '', home: os.homedir() };
    const meta = shellPathMeta(runtime);
    try {
      const content = fs.existsSync(meta.profile) ? fs.readFileSync(meta.profile, 'utf8') : '';
      const next = removeManagedShellPath(content);
      const changed = next !== content;
      if (changed) fs.writeFileSync(meta.profile, next, 'utf8');
      bus.send(changed ? '[环境] 已从 ' + meta.profile + ' 删除工具链 PATH' : '[环境] shell 配置中未找到工具链 PATH，无需删除', changed ? 'success' : 'info');
      if (changed) bus.send('[环境] 新终端打开后生效', 'info');
      return {
        ok: true, supported: true, removed: changed ? dirs : [], dirs,
        scope: 'shell-profile', profile: meta.profile, shell: meta.shellName,
        label: meta.label, present: false
      };
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      bus.send('[环境] 删除 shell PATH 失败: ' + msg, 'error');
      return { ok: false, supported: true, removed: [], dirs, error: msg, message: msg, scope: 'shell-profile', profile: meta.profile, label: meta.label };
    }
  }
  if (process.platform !== 'win32') {
    return { ok: false, removed: [], dirs, supported: false, message: '当前系统不支持自动删除 PATH' };
  }
  if (!dirs.length) return { ok: false, removed: [], dirs: [], message: 'no toolchain dirs' };
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

module.exports = {
  collectToolchainPathDirs,
  readWindowsUserPath,
  writeWindowsUserPath,
  mergePathEntries,
  resolveShellProfile,
  updateManagedShellPath,
  removeManagedShellPath,
  inspectManagedShellPath,
  getShellPathStatus,
  getSystemPathStatus,
  syncSystemPath,
  removeSystemPath
};
