// pyOCD/OpenOCD/Keil 固件烧录流程。
const path = require('path');
const fs = require('fs');
const bus = require('../core/bus');
const { runProcess } = require('../toolchain/proc');
const { cleanPyocd } = require('./flash-parsing');
const { normalizePyocdTarget, openocdTargetConfig } = require('./stm32-targets');
const { diagnoseOpenocdOutput, diagnosePyocdOutput } = require('./pyocd-diagnostics');
const { quoteOpenocdTclPath, prepareOpenocdFirmwarePath } = require('./openocd-paths');
const { PLATFORM_TC } = require('../core/env');
const { resolvePyocdPath, resolveOpenocdPath } = require('../toolchain/toolchain');
const { PYOCD_FLASH_TIMEOUT_MS, pickProbeUid, resolveTarget, ensurePyocdTarget } = require('./probe');
const { resolveFirmware, detectBuildSystem } = require('./project');
const { runUV4 } = require('./build');
const { flashArduino } = require('./arduino');

async function flash(projectDir, cfg) {
  const method = (cfg.flashMethod || 'auto');
  const sys = detectBuildSystem(projectDir, cfg);

  // Arduino 工程：默认 arduino-cli upload；若用户强制 pyocd/openocd/keil 则烧编译产物
  if (sys === 'arduino' || method === 'arduino') {
    if (method === 'pyocd' || method === 'openocd' || method === 'keil') {
      // fall through to probe/keil flashers with resolveFirmware()
    } else {
      return flashArduino(projectDir, cfg);
    }
  }

  if (method === 'keil') return flashKeil(projectDir, cfg);
  if (method === 'openocd') return flashOpenocd(projectDir, cfg);
  if (method === 'arduino') return flashArduino(projectDir, cfg);
  return flashPyocd(projectDir, cfg);
}

async function flashOpenocd(projectDir, cfg) {
  const firmware = resolveFirmware(projectDir, cfg);
  if (!firmware) {
    bus.send(`[烧录] ✗ 在工程目录下找不到 .elf/.axf/.hex 固件，请先编译`, 'error');
    return false;
  }
  const resolved = resolveOpenocdPath(cfg);
  const openocd = resolved.openocd;
  bus.send(`[烧录] OpenOCD 路径: ${openocd || '未配置'}`, 'info');
  bus.send(`[烧录] 固件路径: ${firmware}`, 'info');
  if (!openocd || (openocd.includes(path.sep) && !fs.existsSync(openocd))) {
    bus.send(`[烧录] ✗ OpenOCD 不存在: ${openocd || '未配置'}`, 'error');
    if (process.platform === 'darwin') bus.send('[烧录] macOS 可执行: brew install open-ocd', 'info');
    if (process.platform === 'linux') bus.send('[烧录] Linux 可执行: sudo apt install openocd', 'info');
    return false;
  }
  const target = normalizePyocdTarget(cfg.targetChip);
  const targetCfg = openocdTargetConfig(target);
  const ifaceCfg = cfg.openocdInterface || 'interface/cmsis-dap.cfg';
  const preparedFirmware = prepareOpenocdFirmwarePath(firmware);
  if (preparedFirmware.staged) bus.send(`[烧] OpenOCD 临时固件: ${preparedFirmware.filePath}`, 'info');
  const cmd = `program ${quoteOpenocdTclPath(preparedFirmware.filePath)} verify reset exit`;
  bus.send(`[烧录] OpenOCD 接口: ${ifaceCfg}`, 'info');
  bus.send(`[烧录] OpenOCD 目标: ${targetCfg}`, 'info');
  bus.send(`[烧录] openocd -f ${ifaceCfg} -f ${targetCfg} -c "${cmd}" ...`, 'step');
  const result = await runProcess(openocd, ['-f', ifaceCfg, '-f', targetCfg, '-c', 'adapter speed 1000', '-c', 'transport select swd', '-c', cmd], {
    cwd: projectDir,
    shell: false,
    capture: true
  });
  if (result.code === 0) {
    bus.send('[烧录] ✓ OpenOCD 烧录成功，芯片已复位', 'success');
    return true;
  }
  const diagnostics = diagnoseOpenocdOutput(result.out, { target });
  for (const d of diagnostics) {
    bus.send(`[诊断] ${d.reason}`, 'error');
    bus.send(`[建议] ${d.suggestion}`, 'info');
  }
  bus.send(`[烧录] ✗ OpenOCD 烧录失败 (exit ${result.code})`, 'error');
  return false;
}

async function flashPyocd(projectDir, cfg) {
  const elfPath = resolveFirmware(projectDir, cfg);
  if (!elfPath) {
    bus.send(`[烧录] ✗ 在工程目录下找不到 .elf/.axf/.hex 固件，请先编译`, 'error');
    return false;
  }

  const resolved = resolvePyocdPath(cfg);
  const pyocd = resolved.pyocd;
  if (resolved.switched) {
    bus.send(`[烧录] 检测到非当前系统路径，已切换为 ${PLATFORM_TC.label} 默认 pyOCD`, 'info');
  }
  bus.send(`[烧录] pyOCD 路径: ${pyocd || '未配置'}`, 'info');
  bus.send(`[烧录] 固件路径: ${elfPath}`, 'info');
  if (!pyocd) {
    bus.send('[烧录] ✗ 未配置 pyOCD 路径，请在设置里填写 pyocd 可执行文件路径', 'error');
    return false;
  }
  if (pyocd.includes(path.sep) && !fs.existsSync(pyocd)) {
    bus.send(`[烧录] ✗ pyOCD 文件不存在: ${pyocd}`, 'error');
    if (process.platform === 'darwin') bus.send('[烧录] macOS 可执行: python3 -m pip install --user -U pyocd', 'info');
    if (process.platform === 'linux') bus.send('[烧录] Linux 可执行: python3 -m pip install --user -U pyocd', 'info');
    return false;
  }
  // 多探针时先选定一个，避免 pyocd 因歧义在命令行等待选择而挂死
  const uid = await pickProbeUid({ ...cfg, pyocdPath: pyocd });
  // 用已解析/已跨平台切换后的 pyocd 做自动识别，保持与实际烧录使用同一路径
  const target = await resolveTarget({ ...cfg, pyocdPath: pyocd }, uid);
  if (!await ensurePyocdTarget(pyocd, target)) return false;
  const probeArg = uid ? ['-u', uid] : [];
  const resetArg = cfg.connectUnderReset ? ['-O', 'connect_mode=under-reset'] : [];
  if (cfg.connectUnderReset) bus.send('[烧录] 复位状态下连接(under-reset)', 'info');
  bus.send(`[烧录] pyocd load -t ${target}${uid ? ' -u ' + uid.slice(0, 8) + '…' : ''} ${path.basename(elfPath)} ...`, 'step');
  const result = await runProcess(pyocd, ['load', '-t', target, ...probeArg, ...resetArg, elfPath], {
    cwd: projectDir,
    shell: false,
    clean: cleanPyocd,
    capture: true,
    timeoutMs: PYOCD_FLASH_TIMEOUT_MS
  });
  const code = result.code;
  if (code === 0) {
    bus.send('[烧录] ✓ 烧录成功，芯片已复位', 'success');
    return true;
  }
  if (result.timedOut) {
    bus.send(`[烧录] ✗ 烧录超时（${Math.round(PYOCD_FLASH_TIMEOUT_MS / 1000)} 秒），已停止 pyOCD`, 'error');
    bus.send('[建议] 请检查烧录器是否插入、USB 数据线是否正常、目标板是否供电，或关闭“复位下连接”后重试', 'info');
    return false;
  }
  const diagnostics = diagnosePyocdOutput(result.out, { target });
  for (const d of diagnostics) {
    bus.send(`[诊断] ${d.reason}`, 'error');
    bus.send(`[建议] ${d.suggestion}`, 'info');
  }
  bus.send(`[烧录] ✗ 烧录失败 (exit ${code})`, 'error');
  return false;
}

async function flashKeil(projectDir, cfg) {
  bus.send('[烧录] 使用 Keil UV4 下载（按工程内配置的下载器，如 PWLink2/ST-Link/J-Link）', 'info');
  const { code, log } = await runUV4(cfg, projectDir, 'flash');
  if (code === -1) return false;
  // 优先按日志里的「N Error(s)」数字判定；无该字段时退回退出码（UV4 -f 成功通常为 0）
  const m = log.match(/(\d+)\s+Error\(s\)/i);
  const errors = m ? parseInt(m[1], 10) : null;
  const ok = errors != null ? errors === 0 : (code === 0);
  if (ok) {
    bus.send('[烧录] ✓ 烧录成功', 'success');
    return true;
  }
  bus.send(`[烧录] ✗ 烧录失败${errors != null ? `（${errors} 个错误）` : ` (exit ${code})`}`, 'error');
  return false;
}

module.exports = {
  flash,
  flashOpenocd,
  flashPyocd,
  flashKeil
};
