// Makefile/Keil 编译流程。
const path = require('path');
const fs = require('fs');
const bus = require('../core/bus');
const { getPathsContext } = require('../core/paths-context');
const { runProcess } = require('../toolchain/proc');
const { cleanMake } = require('./flash-parsing');
const { ensureMakefileStartupSources } = require('./makefile-startup-repair');
const { KEIL_SUPPORTED } = require('../core/env');
const {
  effectivePaths,
  buildEnv,
  toolsSearchDirs,
  isToolchainInstalled,
  findExecutableOnPath
} = require('../toolchain/toolchain');
const { detectBuildSystem, makeTargetOverrideArgs, findKeilProject } = require('./project');

async function compile(projectDir, cfg) {
  const sys = detectBuildSystem(projectDir, cfg);
  bus.send(`[编译] 目录: ${projectDir}`, 'step');
  bus.send(`[编译] 编译方式: ${sys === 'keil' ? 'Keil uVision5 (UV4)' : 'Makefile (GCC)'}`, 'info');
  return sys === 'keil' ? compileKeil(projectDir, cfg) : compileMake(projectDir, cfg);
}

function resolveMakeExecutable(cfg) {
  const makeName = process.platform === 'win32' ? 'make.exe' : 'make';
  const eff = effectivePaths(cfg);
  const dirs = [...toolsSearchDirs(), eff.makePath, eff.armGccPath].filter(Boolean);
  for (const d of dirs) {
    const p = path.join(d, makeName);
    if (fs.existsSync(p)) return p;
  }
  return findExecutableOnPath(makeName);
}

async function compileMake(projectDir, cfg) {
  const env = buildEnv(cfg);
  // 优先用解析到的 make 绝对路径(shell:false)；解析不到再回退到 shell 方式找系统 make
  const makeBin = resolveMakeExecutable(cfg);
  const makeCmd = makeBin || 'make';
  const useShell = !makeBin;
  if (!isToolchainInstalled()) {
    bus.send('[编译] ⚠ 未检测到内置编译环境(rm/mkdir 等)，若 make 报「找不到命令」请先点「安装编译环境」', 'info');
  }
  const tgtArgs = makeTargetOverrideArgs(projectDir);  // 中文 TARGET → 命令行 TARGET= 覆盖，不改写用户文件
  const startupRepair = ensureMakefileStartupSources(projectDir);
  for (const src of startupRepair.created) {
    bus.send(`[编译] 已补齐缺失启动文件: ${src}`, 'info');
  }
  if (startupRepair.missing.length) {
    bus.send(`[编译] ✗ Makefile 引用了启动文件但工程内缺失: ${startupRepair.missing.join(', ')}`, 'error');
    bus.send('[编译] 请用 STM32CubeMX 重新生成 Makefile 工程，或把对应 Drivers/CMSIS/.../Templates/gcc/startup_*.s 放到工程目录', 'info');
    return false;
  }
  if (startupRepair.failed.length) {
    bus.send(`[编译] ✗ 找到启动文件模板，但写入工程失败: ${startupRepair.failed.join(', ')}`, 'error');
    bus.send('[编译] 请检查工程目录写入权限，或手动复制对应 startup_*.s 到工程目录', 'info');
    return false;
  }

  bus.send('[编译] make clean ...', 'info');
  const cleanCode = await runProcess(makeCmd, ['clean', ...tgtArgs], { cwd: projectDir, env, shell: useShell, clean: cleanMake });
  if (cleanCode !== 0) {
    bus.send(`[编译] ✗ make clean 失败 (exit ${cleanCode})`, 'error');
    return false;
  }

  // 并行度按 CPU 核数走（至少 2），写死 -j4 会浪费多核机器的编译时间
  const jobs = Math.max(2, require('os').cpus().length);
  bus.send(`[编译] make -j${jobs} ...`, 'step');
  const makeCode = await runProcess(makeCmd, [`-j${jobs}`, ...tgtArgs], { cwd: projectDir, env, shell: useShell, clean: cleanMake });
  if (makeCode === 0) {
    bus.send('[编译] ✓ 编译成功', 'success');
    return true;
  }
  bus.send(`[编译] ✗ 编译失败 (exit ${makeCode})`, 'error');
  return false;
}

async function runUV4(cfg, projectDir, op /* 'build' | 'flash' */) {
  if (!KEIL_SUPPORTED) {
    bus.send(`[${op === 'flash' ? '烧录' : '编译'}] ✗ 当前系统不支持 Keil UV4，仅 Windows 可用`, 'error');
    return { code: -1, log: '' };
  }
  const uv4 = (cfg.keilUV4Path || '').trim();
  if (!uv4 || !fs.existsSync(uv4)) {
    bus.send(`[${op === 'flash' ? '烧录' : '编译'}] ✗ 未找到 UV4.exe（设置里「Keil UV4.exe 路径」: ${uv4 || '空'}）`, 'error');
    return { code: -1, log: '' };
  }
  const proj = findKeilProject(projectDir);
  if (!proj) {
    bus.send(`[${op === 'flash' ? '烧录' : '编译'}] ✗ 工程目录下未找到 Keil 工程文件 (.uvprojx/.uvproj)`, 'error');
    return { code: -1, log: '' };
  }
  const logFile = path.join(getPathsContext().tempDir, `uv4_${op}_${Date.now()}.txt`);
  // -j0 隐藏对话框；-o 把输出写到日志文件（UV4 不走 stdout）
  const cmdFlag = op === 'flash' ? '-f' : (cfg.keilRebuild ? '-z' : '-b');
  const args = [cmdFlag, proj, '-j0', '-o', logFile];
  bus.send(`[${op === 'flash' ? '烧录' : '编译'}] UV4 ${cmdFlag} "${path.basename(proj)}" ...`, 'step');
  // UV4 只把输出写进 -o 日志文件，编译期间轮询该文件、把新增的完整行实时推送到前端
  let sentLines = 0;
  const pumpLog = (final) => {
    let txt = '';
    try { txt = fs.readFileSync(logFile, 'utf8'); } catch { return ''; }
    const lines = txt.split(/\r?\n/);
    // 非最终读取时最后一行可能尚未写完，留到下一轮
    const upto = final ? lines.length : lines.length - 1;
    for (; sentLines < upto; sentLines++) {
      const ln = lines[sentLines];
      if (ln.trim()) bus.send(ln.trimEnd());
    }
    return txt;
  };
  const timer = setInterval(pumpLog, 500);
  // Keil 工程可能在子目录，cwd 用工程文件所在目录，以保证工程内相对路径正确
  let code;
  try {
    // UV4 是 GUI 程序，忽略 windowsHide；用 PowerShell Start-Process -WindowStyle Hidden
    // 在后台隐藏窗口运行，-Wait 等待结束并透传退出码（输出仍走 -o 日志文件轮询）
    const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;
    // Start-Process 拼接 ArgumentList 时不会自动加引号，含空格的路径参数需自带双引号
    const psArg = (s) => psq(/\s/.test(String(s)) ? `"${s}"` : s);
    const psCmd = `$p = Start-Process -FilePath ${psq(uv4)} -ArgumentList @(${args.map(psArg).join(', ')}) `
      + `-WorkingDirectory ${psq(path.dirname(proj))} -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode`;
    code = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCmd],
      { cwd: path.dirname(proj), shell: false, windowsHide: true });
  } finally {
    clearInterval(timer);
  }
  const log = pumpLog(true);
  try { fs.unlinkSync(logFile); } catch {}
  return { code, log };
}

async function compileKeil(projectDir, cfg) {
  const { code, log } = await runUV4(cfg, projectDir, 'build');
  if (code === -1) return false;
  // 优先按日志里的「N Error(s)」判定；否则用退出码（UV4: 0=无告警/错误,1=有告警,>=2=错误）
  const m = log.match(/(\d+)\s+Error\(s\)/i);
  const errors = m ? parseInt(m[1], 10) : null;
  const ok = errors != null ? errors === 0 : (code === 0 || code === 1);
  if (ok) {
    bus.send('[编译] ✓ 编译成功', 'success');
    return true;
  }
  bus.send(`[编译] ✗ 编译失败${errors != null ? `（${errors} 个错误）` : ` (exit ${code})`}`, 'error');
  return false;
}

module.exports = {
  compile,
  resolveMakeExecutable,
  compileMake,
  runUV4,
  compileKeil
};
