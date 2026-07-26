// BusyBox、Python 工具和默认交叉编译工具链的安装流程。
const path = require('path');
const fs = require('fs');
const { getToolchainDownloadPlan } = require('./platform-toolchains');
const { PLATFORM_TC } = require('../core/config');
const { applyMirror, downloadFast } = require('./downloader');
const bus = require('../core/bus');
const { runProcess } = require('./proc');
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
  installToolchain,
  installLocalPyocd,
  installLocalStcgal,
  installLocalEsptool,
  downloadAndExtract,
  installDefaultToolchain
};
