// BusyBox、Python 工具和默认交叉编译工具链的安装流程。
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { getToolchainDownloadPlan } = require('./platform-toolchains');
const { PLATFORM_TC } = require('../core/env');
const { applyMirror, downloadFast } = require('./downloader');
const bus = require('../core/bus');
const { runProcess, runCapture } = require('./proc');
const {
  toolsDir,
  toolchainRoot,
  localPyocdRoot,
  localPyocdBin,
  localStcgalRoot,
  localStcgalBin,
  localEsptoolRoot,
  localEsptoolBin,
  findPythonCommand,
  migrateLegacyToolchainIfNeeded
} = require('./paths');
const { APPLETS, systemLogLabel, defaultToolchainStatus } = require('./status');

const MANAGED_DOWNLOAD_DIRS = new Set(['gcc', 'make', 'openocd']);

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function managedDestination(destDir) {
  const root = path.resolve(toolchainRoot());
  const dest = path.resolve(destDir);
  const name = path.basename(dest).toLowerCase();
  if (!samePath(path.dirname(dest), root) || !MANAGED_DOWNLOAD_DIRS.has(name)) {
    throw new Error(`拒绝操作非托管工具链目录: ${dest}`);
  }
  return { root, dest, name };
}

function removeManagedTemp(dirPath, root, prefix, ignoreErrors = false) {
  const resolved = path.resolve(dirPath);
  const baseName = path.basename(resolved);
  const prefixMatches = process.platform === 'win32'
    ? baseName.toLowerCase().startsWith(String(prefix).toLowerCase())
    : baseName.startsWith(prefix);
  if (!samePath(path.dirname(resolved), root) || !prefixMatches) {
    throw new Error(`拒绝清理非托管临时目录: ${resolved}`);
  }
  try { fs.rmSync(resolved, { recursive: true, force: true }); }
  catch (e) {
    if (!ignoreErrors) throw e;
    return e;
  }
  return null;
}

function hashFile(filePath, algorithm) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const input = fs.createReadStream(filePath);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolve(hash.digest()));
  });
}

async function verifyArchiveHash(archive, spec) {
  const expectedSha256 = String((spec && spec.sha256) || '').trim();
  const expectedSha512 = String((spec && spec.sha512) || '').trim();
  const algorithm = expectedSha256 ? 'sha256' : (expectedSha512 ? 'sha512' : '');
  const expected = expectedSha256 || expectedSha512;
  if (!algorithm) return { verified: false, algorithm: '' };
  const digestBytes = algorithm === 'sha256' ? 32 : 64;
  let expectedBuf;
  if (new RegExp(`^[a-f0-9]{${digestBytes * 2}}$`, 'i').test(expected)) {
    expectedBuf = Buffer.from(expected, 'hex');
  } else if (/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(expected)) {
    expectedBuf = Buffer.from(expected, 'base64');
  } else {
    throw new Error(`${algorithm.toUpperCase()} 配置格式无效`);
  }
  if (expectedBuf.length !== digestBytes) {
    throw new Error(`${algorithm.toUpperCase()} 配置长度无效`);
  }
  const actualBuf = await hashFile(archive, algorithm);
  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    throw new Error(`${algorithm.toUpperCase()} 校验失败`);
  }
  return { verified: true, algorithm };
}

function validateArchiveEntryNames(text) {
  for (const raw of String(text || '').split(/\r?\n/)) {
    const name = raw.trim().replace(/\\/g, '/');
    if (!name || name === '.') continue;
    if (name.startsWith('/') || /^[a-z]:\//i.test(name) || name.split('/').includes('..')) {
      throw new Error(`安装包包含越界路径: ${raw}`);
    }
  }
}

function isPathInside(baseDir, targetPath) {
  const rel = path.relative(path.resolve(baseDir), path.resolve(targetPath));
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

function validateExtractedTree(rootDir) {
  const root = fs.realpathSync(rootDir);
  const pending = [rootDir];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current)) {
      const full = path.join(current, entry);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) {
        let target;
        try { target = fs.realpathSync(full); }
        catch { throw new Error(`安装包包含无法解析的符号链接: ${path.relative(rootDir, full)}`); }
        if (!isPathInside(root, target)) {
          throw new Error(`安装包符号链接越界: ${path.relative(rootDir, full)}`);
        }
      } else if (stat.isDirectory()) {
        pending.push(full);
      }
    }
  }
}

async function extractArchive(spec, archive, stagingDir) {
  if (spec.archiveType === 'tar.gz') {
    const listed = await runCapture('tar', ['-tzf', archive], { shell: false, timeoutMs: 120000 });
    if (listed.code !== 0) throw new Error(`无法读取 tar 安装包 (exit ${listed.code})`);
    validateArchiveEntryNames(listed.out);
    return await runProcess('tar', ['-xzf', archive, '-C', stagingDir], { shell: false });
  }

  const psScript = [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    '$archive = [IO.Path]::GetFullPath($env:MCU_TOOLBOX_ARCHIVE)',
    '$dest = [IO.Path]::GetFullPath($env:MCU_TOOLBOX_DEST)',
    '$prefix = $dest.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar',
    '$zip = [IO.Compression.ZipFile]::OpenRead($archive)',
    'try {',
    '  foreach ($entry in $zip.Entries) {',
    '    $target = [IO.Path]::GetFullPath([IO.Path]::Combine($dest, $entry.FullName))',
    '    if ($target -ne $dest -and -not $target.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {',
    "      throw ('安装包包含越界路径: ' + $entry.FullName)",
    '    }',
    '  }',
    '} finally { $zip.Dispose() }',
    'Expand-Archive -LiteralPath $archive -DestinationPath $dest -Force'
  ].join('\n');
  const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
  return await runProcess(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    {
      shell: false,
      env: Object.assign({}, process.env, {
        MCU_TOOLBOX_ARCHIVE: archive,
        MCU_TOOLBOX_DEST: stagingDir
      })
    }
  );
}

function replaceDirectoryTransactional(destDir, stagingDir, root, name) {
  const backupDir = path.join(root, `${name}.backup-${process.pid}-${Date.now()}`);
  removeManagedTemp(backupDir, root, `${name}.backup-`);
  let movedExisting = false;
  try {
    if (fs.existsSync(destDir)) {
      fs.renameSync(destDir, backupDir);
      movedExisting = true;
    }
    fs.renameSync(stagingDir, destDir);
  } catch (e) {
    let rollbackError = null;
    if (movedExisting && !fs.existsSync(destDir) && fs.existsSync(backupDir)) {
      try { fs.renameSync(backupDir, destDir); }
      catch (rollback) { rollbackError = rollback; }
    }
    if (rollbackError) {
      throw new Error(`安装替换失败: ${e.message}; 回滚失败: ${rollbackError.message}`);
    }
    throw e;
  }
  const cleanupError = removeManagedTemp(backupDir, root, `${name}.backup-`, true);
  if (cleanupError) {
    bus.send(`[环境] 工具链已替换，但旧备份目录清理失败: ${backupDir} (${cleanupError.message})`, 'warn');
  }
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

async function downloadAndExtract(spec, label, destDir, cfg) {
  if (!spec || spec.mode !== 'download' || !spec.url) return false;
  if (spec.archiveType !== 'zip' && spec.archiveType !== 'tar.gz') {
    throw new Error(`不支持的安装包格式: ${spec.archiveType || '未指定'}`);
  }
  if (process.platform !== 'win32' && spec.archiveType === 'zip') {
    bus.send(`[环境] ✗ 平台匹配错误：${PLATFORM_TC.label} 不应下载 ${label} 的 Windows zip 包`, 'error');
    bus.send(`[环境] 当前系统: ${process.platform}/${process.arch}`, 'error');
    bus.send(`[环境] 错误地址: ${spec.url || '无'}`, 'error');
    return false;
  }
  const managed = managedDestination(destDir);
  fs.mkdirSync(managed.root, { recursive: true });
  const archiveExt = spec.archiveType === 'tar.gz' ? '.tar.gz' : '.zip';
  const requestedArchiveName = spec.fileName || (label + archiveExt);
  const archiveName = path.basename(requestedArchiveName);
  if (archiveName !== requestedArchiveName || !archiveName) {
    throw new Error(`非法安装包文件名: ${requestedArchiveName}`);
  }
  const archive = path.join(managed.root, archiveName);
  const downloadUrl = applyMirror(spec.url, cfg);
  bus.send(`[环境] 正在下载 ${label}（8 线程加速）...`, 'step');
  bus.send(`[系统] 当前系统: ${systemLogLabel()}`, 'info');
  bus.send(`[环境] 识别系统: ${PLATFORM_TC.label} (${process.platform}/${process.arch})`, 'info');
  bus.send(`[环境] 匹配包: ${archiveName}`, 'info');
  bus.send(`[环境] 原始地址: ${spec.url}`, 'info');
  if (downloadUrl !== spec.url) bus.send(`[环境] 实际地址: ${downloadUrl}`, 'info');
  bus.send(`[环境] 保存路径: ${archive}`, 'info');
  bus.send(`[环境] 解压目录: ${managed.dest}`, 'info');
  bus.send(`[环境] 手动下载: 如自动下载失败，可下载上面的原始地址，并将文件放到保存路径后重试`, 'info');
  let lastPct = -1, lastT = 0;
  let reuseArchive = false;
  const existingMb = fs.existsSync(archive) ? ((fs.statSync(archive).size / 1048576) | 0) : 0;
  if (existingMb >= 10) {
    try {
      const integrity = await verifyArchiveHash(archive, spec);
      reuseArchive = true;
      bus.send(
        integrity.verified
          ? `[环境] 检测到已校验的本地安装包 (${existingMb} MB)，跳过下载`
          : `[环境] 检测到本地安装包 (${existingMb} MB)，未提供哈希，直接尝试解压`,
        integrity.verified ? 'success' : 'warn'
      );
    } catch (e) {
      bus.send(`[环境] 本地安装包校验失败，删除后重新下载: ${e.message}`, 'warn');
      try { fs.unlinkSync(archive); } catch {}
    }
  }
  if (!reuseArchive) {
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
  try {
    const integrity = await verifyArchiveHash(archive, spec);
    if (integrity.verified) bus.send(`[环境] ✓ ${label} ${integrity.algorithm.toUpperCase()} 校验通过`, 'success');
    else bus.send(`[环境] ${label} 未配置哈希，仅完成 HTTPS 与下载长度校验`, 'warn');
  } catch (e) {
    try { fs.unlinkSync(archive); } catch {}
    throw e;
  }
  const mb = (fs.statSync(archive).size / 1048576) | 0;
  bus.send(`[环境] ✓ ${label} 下载完成 (${mb} MB)，正在临时目录解压 ...`, 'info');
  const stagingDir = path.join(managed.root, `${managed.name}.install-${process.pid}-${Date.now()}`);
  removeManagedTemp(stagingDir, managed.root, `${managed.name}.install-`);
  fs.mkdirSync(stagingDir, { recursive: true });
  try {
    const code = await extractArchive(spec, archive, stagingDir);
    if (code !== 0) throw new Error(`解压进程退出码 ${code}`);
    if (!fs.readdirSync(stagingDir).length) throw new Error('解压结果为空');
    validateExtractedTree(stagingDir);
    replaceDirectoryTransactional(managed.dest, stagingDir, managed.root, managed.name);
  } catch (e) {
    const cleanupError = removeManagedTemp(stagingDir, managed.root, `${managed.name}.install-`, true);
    if (cleanupError) {
      bus.send(`[环境] 临时解压目录清理失败: ${stagingDir} (${cleanupError.message})`, 'warn');
    }
    bus.send(`[环境] ✗ ${label} 安装失败，已保留原工具链: ${e.message}`, 'error');
    return false;
  }
  try { fs.unlinkSync(archive); } catch {}
  bus.send(`[环境] ✓ ${label} 已完成校验、解压与原子替换`, 'success');
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
  // 安装结果以 defaultToolchainStatus() 复检为准
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
    if (gccTask) {
      if (!force && before.gccBin) {
        bus.send(`[环境] ✓ ARM GCC 已存在，跳过下载: ${before.gccBin}`, 'info');
      } else {
        await downloadAndExtract(gccTask.spec, gccTask.label, path.join(root, 'gcc'), cfg);
      }
    }

    // make：Windows 下载，mac/Linux 使用系统自带
    const makeTask = plan.downloads.find((x) => x.key === 'make');
    if (makeTask) {
      if (!force && before.makeBin && before.makeBin !== 'system') {
        bus.send(`[环境] ✓ make 已存在，跳过下载: ${before.makeBin}`, 'info');
      } else {
        await downloadAndExtract(makeTask.spec, makeTask.label, path.join(root, 'make'), cfg);
      }
    } else {
      const makeSys = plan.system.find((x) => x.key === 'make');
      if (makeSys) bus.send(`[环境] ${PLATFORM_TC.label} 使用系统自带 make: ${makeSys.spec.pathDisplay}`, 'info');
    }

    const pyocdTask = plan.downloads.find((x) => x.key === 'pyocd');
    if (pyocdTask) await installLocalPyocd(force);

    const openocdTask = plan.downloads.find((x) => x.key === 'openocd');
    if (openocdTask) {
      if (!force && before.openocdBin) {
        bus.send(`[环境] ✓ OpenOCD 已存在，跳过下载: ${before.openocdBin}`, 'info');
      } else {
        await downloadAndExtract(openocdTask.spec, openocdTask.label, path.join(root, 'openocd'), cfg);
      }
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
  installToolchain,
  installLocalPyocd,
  installLocalStcgal,
  installLocalEsptool,
  downloadAndExtract,
  installDefaultToolchain
};
