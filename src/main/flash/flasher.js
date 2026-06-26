// 编译与烧录核心：芯片/探针探测、Keil/CubeMX 工程识别、make/Keil 编译、pyOCD/OpenOCD/Keil 烧录。
// 日志经 bus；进程执行复用 proc；路径解析复用 toolchain。
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const bus = require('../core/bus');
const { runProcess, runCapture } = require('../toolchain/proc');
const { DEVID_MAP, chooseProbe, cleanPyocd, cleanMake, cleanCubeMx, asciiTargetName, parseStm32DevidFromValues } = require('./flash-parsing');
const { normalizePyocdTarget, isStm32Target, openocdTargetConfig } = require('./stm32-targets');
const { diagnoseOpenocdOutput, diagnosePyocdOutput } = require('./pyocd-diagnostics');
const { quoteOpenocdTclPath, prepareOpenocdFirmwarePath } = require('./openocd-paths');
const { ensureMakefileStartupSources } = require('./makefile-startup-repair');
const { PLATFORM_TC, KEIL_SUPPORTED, loadConfig } = require('../core/config');
const {
  effectivePaths,
  buildEnv,
  resolvePyocdPath,
  resolveOpenocdPath,
  toolsSearchDirs,
  isToolchainInstalled,
  findExecutableOnPath
} = require('../toolchain/toolchain');

async function pyocdHasTarget(pyocd, target) {
  const { out } = await runCapture(pyocd, ['list', '--targets'], { shell: false, timeoutMs: 20000 });
  // target 经 normalizePyocdTarget 只含 [a-z0-9]，无正则特殊字符；按独立 token 匹配，容忍不同版本表格缩进/列布局
  return new RegExp(`(?:^|\\s)${target}(?:\\s|$)`, 'im').test(out);
}

// 缓存本进程已确认存在的 (pyocd, target)，避免每次烧录都跑耗时的 `pyocd list --targets`
const _pyocdTargetOk = new Set();
async function ensurePyocdTarget(pyocd, target) {
  if (!target) return true;
  const cacheKey = `${pyocd}::${target}`;
  if (_pyocdTargetOk.has(cacheKey)) return true;
  if (await pyocdHasTarget(pyocd, target)) { _pyocdTargetOk.add(cacheKey); return true; }
  if (isStm32Target(target)) {
    bus.send(`[烧录] pyOCD 缺少目标 ${target}，正在安装 STM32 官方 Pack ...`, 'info');
    const code = await runProcess(pyocd, ['pack', 'install', target.toUpperCase()], { shell: false });
    if (code === 0 && await pyocdHasTarget(pyocd, target)) {
      _pyocdTargetOk.add(cacheKey);
      bus.send(`[烧录] ✓ STM32 Pack 已就绪，使用目标: ${target}`, 'success');
      return true;
    }
  }
  bus.send(`[烧录] ✗ pyOCD 不支持目标: ${target}`, 'error');
  bus.send(`[烧录] 可手动执行: ${pyocd} pack install ${target.toUpperCase()}`, 'info');
  return false;
}

// 枚举调试探针（pyocd list），解析出 {index,name,uid}
async function listProbes(cfg) {
  const { out, timedOut } = await runCapture(cfg.pyocdPath, ['list'], { shell: false, timeoutMs: 12000 });
  if (timedOut) return { probes: [], timedOut: true, out };
  const probes = [];
  for (const line of String(out).split(/\r?\n/)) {
    // 行形如："  0   Arm DAPLink CMSIS-DAP   4559CBD2...   n/a"（名称含空格，UID/Target 用多空格分隔）
    const m = line.match(/^\s*(\d+)\s+(.+?)\s{2,}(\S+)\s+\S+\s*$/);
    if (m) probes.push({ index: Number(m[1]), name: m[2].trim(), uid: m[3].trim() });
  }
  return { probes, out };
}

// 返回要用的探针 UID（-u 参数）；只有 0/1 个探针时不需指定
async function pickProbeUid(cfg) {
  const { probes, timedOut } = await listProbes(cfg);
  if (timedOut) { bus.send('[烧录] ⚠ 枚举调试探针超时', 'info'); return null; }
  if (probes.length <= 1) return null;          // 单探针 pyocd 不会询问，无需 -u
  const chosen = chooseProbe(probes);
  if (chosen) bus.send(`[烧录] 检测到 ${probes.length} 个调试探针，自动选择: ${chosen.name}（UID ${chosen.uid.slice(0, 8)}…）`, 'info');
  return chosen ? chosen.uid : null;
}

async function checkProbeInfo(cfg = loadConfig()) {
  const resolved = resolvePyocdPath(cfg);
  const pyocd = resolved.pyocd;
  if (!pyocd || (pyocd.includes(path.sep) && !fs.existsSync(pyocd))) {
    return { ok: false, error: `pyOCD 不存在: ${pyocd || '未配置'}`, pyocd };
  }
  const r = await listProbes({ ...cfg, pyocdPath: pyocd });
  if (r.timedOut) return { ok: false, error: '枚举烧录器超时', pyocd, probes: [] };
  const chosen = chooseProbe(r.probes);
  return {
    ok: r.probes.length > 0,
    error: r.probes.length > 0 ? '' : '未检测到烧录器：请确认 PWLink/CMSIS-DAP 已插入、USB 线支持数据传输，并重新插拔后再试',
    pyocd,
    probes: r.probes,
    chosen,
    diagnostic: r.out || ''
  };
}

async function readChipInfo(cfg = loadConfig()) {
  const probeInfo = await checkProbeInfo(cfg);
  if (!probeInfo.ok) return probeInfo;
  const uid = probeInfo.chosen ? probeInfo.chosen.uid : null;
  const pyocd = probeInfo.pyocd;
  let detected = await detectChip({ ...cfg, pyocdPath: pyocd }, uid);
  if (!(detected && detected.detected)) {
    const openocdDetected = await detectChipWithOpenocd(cfg).catch(() => null);
    if (openocdDetected && (openocdDetected.detected || openocdDetected.devid != null)) detected = openocdDetected;
  }
  const target = normalizePyocdTarget(cfg.targetChip);
  await ensurePyocdTarget(pyocd, target);
  return {
    ok: true,
    pyocd,
    probe: probeInfo.chosen || probeInfo.probes[0],
    target,
    detected: !!(detected && detected.detected),
    devid: detected && detected.devid != null ? `0x${detected.devid.toString(16)}` : '',
    name: detected && detected.entry ? detected.entry.name : '',
    timedOut: !!(detected && detected.timedOut),
    diagnostic: detected && detected.out ? summarizeDetectOutput(detected.out) : ''
  };
}

function normalizeDebugHex(value, fallback) {
  const s = String(value || '').trim();
  if (/^0x[0-9a-f]+$/i.test(s)) return s;
  if (/^[0-9a-f]+$/i.test(s)) return `0x${s}`;
  return fallback;
}

function parseDebugAddress(value) {
  const s = normalizeDebugHex(value, '');
  if (!s) return null;
  const n = Number.parseInt(s, 16);
  return Number.isFinite(n) ? n : null;
}

function isFlashAddress(address) {
  return address >= 0x08000000 && address < 0x10000000;
}

async function hardwareDebugCommand(action, opts = {}, cfg = loadConfig()) {
  const resolved = resolvePyocdPath(cfg);
  const pyocd = resolved.pyocd;
  if (!pyocd || (pyocd.includes(path.sep) && !fs.existsSync(pyocd))) {
    return { ok: false, error: `pyOCD 不存在: ${pyocd || '未配置'}`, pyocd };
  }

  const uid = await pickProbeUid({ ...cfg, pyocdPath: pyocd });
  const target = normalizePyocdTarget(cfg.targetChip);
  if (!await ensurePyocdTarget(pyocd, target)) return { ok: false, error: `pyOCD 不支持目标: ${target}`, pyocd, target };

  const probeArg = uid ? ['-u', uid] : [];
  const resetArg = cfg.connectUnderReset ? ['-O', 'connect_mode=under-reset'] : [];
  const address = normalizeDebugHex(opts.address, '0x20000000');
  const value = normalizeDebugHex(opts.value, '0x00000000');
  const count = Math.min(256, Math.max(1, Number(opts.count) || 4));
  const addressNum = parseDebugAddress(address);

  let args;
  let label;
  if (action === 'reset') {
    label = '复位运行';
    args = ['reset', '-t', target, ...probeArg, ...resetArg];
  } else if (action === 'halt') {
    label = '暂停 CPU';
    args = ['cmd', '-t', target, ...probeArg, ...resetArg, '-c', 'halt'];
  } else if (action === 'resume') {
    label = '继续运行';
    args = ['cmd', '-t', target, ...probeArg, ...resetArg, '-c', 'resume'];
  } else if (action === 'erase') {
    label = '整片擦除';
    args = ['erase', '-t', target, ...probeArg, ...resetArg, '--chip'];
  } else if (action === 'read32') {
    label = `读取内存 ${address}`;
    args = ['cmd', '-t', target, ...probeArg, ...resetArg, '-c', `read32 ${address} ${count}`];
  } else if (action === 'write32') {
    if (addressNum == null) return { ok: false, error: `地址格式无效: ${opts.address || ''}` };
    if (isFlashAddress(addressNum)) {
      return {
        ok: false,
        error: `0x${addressNum.toString(16)} 属于 Flash 区，不能用 write32 单字写入。请使用“烧录固件”或“整片擦除”。`,
        address
      };
    }
    label = `写入内存 ${address}`;
    args = ['cmd', '-t', target, ...probeArg, ...resetArg, '-c', `write32 ${address} ${value}`];
  } else {
    return { ok: false, error: `未知硬件调试命令: ${action}` };
  }

  bus.send(`[硬件] ${label}：pyocd ${args.join(' ')}`, 'step');
  const result = await runProcess(pyocd, args, { shell: false, capture: true, clean: cleanPyocd });
  const ok = result.code === 0;
  bus.send(ok ? `[硬件] ✓ ${label}完成` : `[硬件] ✗ ${label}失败 (exit ${result.code})`, ok ? 'success' : 'error');
  return { ok, code: result.code, out: result.out, pyocd, target, address, value, count };
}

function summarizeDetectOutput(out) {
  return String(out || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(-5).join(' / ');
}

async function detectChipWithOpenocd(cfg) {
  const resolved = resolveOpenocdPath(cfg);
  const openocd = resolved.openocd;
  if (!openocd || (openocd.includes(path.sep) && !fs.existsSync(openocd))) return null;
  const target = normalizePyocdTarget(cfg.targetChip);
  const targetCfg = openocdTargetConfig(target);
  const ifaceCfg = cfg.openocdInterface || 'interface/cmsis-dap.cfg';
  const cmd = 'init; targets; echo [capture "mdw 0xe0042000 1"]; echo [capture "mdw 0x40015800 1"]; shutdown';
  const { out, timedOut } = await runCapture(openocd, ['-f', ifaceCfg, '-f', targetCfg, '-c', 'adapter speed 1000', '-c', 'transport select swd', '-c', cmd], {
    shell: false,
    timeoutMs: 15000
  });
  const parsed = parseStm32DevidFromValues(out);
  return Object.assign(parsed, { out, timedOut, source: 'openocd' });
}

async function detectChip(cfg, uid) {
  let lastOut = '';
  let lastVal = null;
  // 先试通用 cortex_m，连不上再用设置里的芯片（它能正常烧录，必然能连上读 IDCODE）
  let timedOut = false;
  const probeArg = uid ? ['-u', uid] : [];
  const resetArg = cfg.connectUnderReset ? ['-O', 'connect_mode=under-reset'] : [];
  const targets = [...new Set(['cortex_m', cfg.targetChip].filter(Boolean))];
  for (const tgt of targets) {
    // 关键：一次连接(=一次硬件复位)内读两个 DBGMCU 地址，避免反复连接把芯片复位多次
    // 加 15s 超时：探针被占用/掉线时 pyocd 会一直挂着，超时则放弃自动识别回退到设置芯片
    const { out, timedOut: to } = await runCapture(
      cfg.pyocdPath,
      ['cmd', '-t', tgt, ...probeArg, ...resetArg, '-c', 'read32 0xe0042000', '-c', 'read32 0x40015800'],
      { shell: false, timeoutMs: 15000 }
    );
    lastOut = out;
    if (to) { timedOut = true; break; }   // 超时不再换目标重试，直接回退

    // 输出形如 "0xe0042000:  0x10036410"，取所有读到的数据值；低 12 位即 DEV_ID
    const tokens = (out.match(/0x[0-9a-fA-F]+/g) || []).map((h) => parseInt(h, 16));
    const vals = tokens.filter((v) => v !== 0xe0042000 && v !== 0x40015800);
    for (const v of vals) {
      if (!v) continue;
      lastVal = v;
      const devid = v & 0xFFF;
      if (DEVID_MAP[devid]) return { detected: true, devid, entry: DEVID_MAP[devid], out };
    }
    // 这次连接已读到值(即便型号表里没有)，说明探针正常，不再换目标重复复位
    if (vals.some((v) => v)) break;
  }
  return { detected: false, out: lastOut, devid: lastVal == null ? null : (lastVal & 0xFFF), timedOut };
}

async function resolveTarget(cfg, uid) {
  if (!cfg.autoDetectChip) return normalizePyocdTarget(cfg.targetChip);
  bus.send('[烧录] 正在识别目标芯片 ...', 'info');
  let res;
  try { res = await detectChip(cfg, uid); } catch { res = { detected: false }; }
  if (res && res.timedOut) {
    const target = normalizePyocdTarget(cfg.targetChip);
    bus.send(`[烧录] ⚠ 芯片识别超时（探针可能被占用/未连接/驱动异常），跳过自动识别，使用目标: ${target}`, 'info');
    return target;
  }
  if (res.detected) {
    const { devid, entry } = res;
    // 设置里的芯片若属同家族则保留（更精确），否则用探测代表型号
    const useConfig = cfg.targetChip && cfg.targetChip.toLowerCase().startsWith(entry.family);
    const target = normalizePyocdTarget(useConfig ? cfg.targetChip : entry.target);
    bus.send(`[烧录] ✓ 识别到 ${entry.name}（DEV_ID 0x${devid.toString(16)}），目标: ${target}`, 'success');
    return target;
  }
  const fallbackTarget = normalizePyocdTarget(cfg.targetChip);
  // 克隆探针（PWLink2 等）不返回 ST IDCODE，识别失败属正常，不刷诊断噪声
  if (res && res.out && /Not a genuine ST Device|Board ID .* not recognized/i.test(res.out)) {
    bus.send(`[烧录] 非原厂/克隆探针无法读取芯片 ID，使用目标: ${fallbackTarget}`, 'info');
  } else {
    bus.send(`[烧录] 未能自动识别芯片，使用目标: ${fallbackTarget}`, 'info');
    if (res && res.devid != null) {
      bus.send(`[烧录] （读到 DEV_ID 0x${res.devid.toString(16)}，不在内置型号表，请反馈我补充）`, 'info');
    } else if (res && res.out) {
      const tail = res.out.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim()).slice(-4).join(' / ');
      if (tail) bus.send(`[烧录] 诊断: ${tail}`, 'info');
    }
  }
  if (fallbackTarget !== String(cfg.targetChip || '').trim().toLowerCase()) {
    bus.send(`[烧录] pyOCD 目标别名: ${cfg.targetChip} -> ${fallbackTarget}`, 'info');
  }
  return fallbackTarget;
}

/* ── Keil uVision5 工程探测与编译方式判定 ─────────────── */
// 在工程目录及其子目录查找 Keil 工程文件（限深度 BFS：优先 .uvprojx，其次 .uvproj，浅层优先）
function findKeilProject(projectDir) {
  if (!projectDir || !fs.existsSync(projectDir)) return null;
  const maxDepth = 4;
  const queue = [{ dir: projectDir, d: 0 }];
  let fallbackUvproj = null;
  while (queue.length) {
    const { dir, d } = queue.shift();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    const x = entries.find((e) => e.isFile() && e.name.toLowerCase().endsWith('.uvprojx'));
    if (x) return path.join(dir, x.name);                         // .uvprojx 最优先，找到即返回
    if (!fallbackUvproj) {
      const o = entries.find((e) => e.isFile() && e.name.toLowerCase().endsWith('.uvproj'));
      if (o) fallbackUvproj = path.join(dir, o.name);             // 老格式先记下，没 .uvprojx 时才用
    }
    if (d < maxDepth) {
      for (const e of entries) {
        if (e.isDirectory() && e.name !== 'node_modules' && e.name.toLowerCase() !== 'build' && !e.name.startsWith('.')) {
          queue.push({ dir: path.join(dir, e.name), d: d + 1 });
        }
      }
    }
  }
  return fallbackUvproj;
}

// 在工程目录及其子目录查找 STM32CubeMX 工程文件 .ioc（限深度 BFS，浅层优先）
function findIocFile(projectDir) {
  if (!projectDir || !fs.existsSync(projectDir)) return null;
  const maxDepth = 3;
  const queue = [{ dir: projectDir, d: 0 }];
  while (queue.length) {
    const { dir, d } = queue.shift();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    const ioc = entries.find((e) => e.isFile() && e.name.toLowerCase().endsWith('.ioc'));
    if (ioc) return path.join(dir, ioc.name);                       // 找到即返回，浅层优先
    if (d < maxDepth) {
      for (const e of entries) {
        if (e.isDirectory() && e.name !== 'node_modules' && e.name.toLowerCase() !== 'build' && !e.name.startsWith('.')) {
          queue.push({ dir: path.join(dir, e.name), d: d + 1 });
        }
      }
    }
  }
  return null;
}

// 若 Makefile 的 TARGET 含非 ASCII（中文工程名），arm-none-eabi-ld / make 处理中文输出文件名
// (.elf/.map/.bin) 会报 "Illegal byte sequence" / "Invalid argument" 导致链接失败。
// 这里不再改写用户的 Makefile，而是在本次 make 命令行用 `TARGET=<ascii>` 临时覆盖。
function makeTargetOverrideArgs(projectDir) {
  let txt;
  try { txt = fs.readFileSync(path.join(projectDir, 'Makefile'), 'utf8'); } catch { return []; }
  const m = txt.match(/^\s*TARGET\s*=\s*(.+?)\s*$/m);
  if (!m) return [];
  const orig = m[1].trim();
  if (/^[\x20-\x7E]+$/.test(orig)) return [];          // 已是纯 ASCII，无需覆盖
  const ascii = asciiTargetName(orig);
  bus.send(`[编译] 工程名含中文「${orig}」，本次编译用 TARGET=${ascii} 覆盖（不修改你的 Makefile）`, 'info');
  return [`TARGET=${ascii}`];
}

// 判定实际使用的编译方式：'make' 或 'keil'
function detectBuildSystem(projectDir, cfg) {
  const mode = (cfg && cfg.buildSystem) || 'auto';
  if (mode === 'make') return 'make';
  if (mode === 'keil') return KEIL_SUPPORTED ? 'keil' : 'make';
  // auto：Keil 工程优先；否则有 Makefile 走 make；都没有默认 make
  if (KEIL_SUPPORTED && findKeilProject(projectDir)) return 'keil';
  if (fs.existsSync(path.join(projectDir, 'Makefile'))) return 'make';
  return 'make';
}

/* ── 解析可烧录固件：build/ 下 .elf/.axf/.hex，回退到工程内查找 ── */
function resolveFirmware(projectDir, cfg) {
  const buildDir = path.join(projectDir, 'build');
  if (cfg.elfName) {
    const p = path.join(buildDir, cfg.elfName);
    if (fs.existsSync(p)) return p;
  }
  const exts = ['.elf', '.axf', '.hex'];
  // 1) 优先 build/ 目录
  if (fs.existsSync(buildDir)) {
    const cands = fs.readdirSync(buildDir).filter((f) => exts.includes(path.extname(f).toLowerCase()));
    if (cands.length) {
      const preferred = cands.find((f) => f === 'classroom_ctrl.elf')
        || cands.find((f) => path.extname(f).toLowerCase() === '.elf')
        || cands.find((f) => path.extname(f).toLowerCase() === '.axf')
        || cands[0];
      return path.join(buildDir, preferred);
    }
  }
  // 2) 回退：在工程内有限深度查找 .axf/.hex（Keil 常输出到 Objects/ 等）
  const stack = [{ dir: projectDir, d: 0 }];
  const found = [];
  while (stack.length) {
    const { dir, d } = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isFile() && ['.axf', '.hex', '.elf'].includes(path.extname(e.name).toLowerCase())) {
        found.push(path.join(dir, e.name));
      }
    }
    if (d < 3) {
      for (const e of entries) {
        if (e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.')) {
          stack.push({ dir: path.join(dir, e.name), d: d + 1 });
        }
      }
    }
  }
  if (!found.length) return null;
  found.sort((a, b) => {
    const r = (p) => ({ '.axf': 0, '.elf': 0, '.hex': 1 }[path.extname(p).toLowerCase()] ?? 2);
    return r(a) - r(b);
  });
  return found[0];
}

/* ── 一键生成 Makefile：调 STM32CubeMX 命令行把工程重生成为 Makefile 工程 ──
 * 适用于 CubeMX 生成的 EWARM/IAR、MDK 等工程（目录只有 .ioc 没有 Makefile），
 * 由 CubeMX 官方正确产出 Makefile + GNU 启动文件(startup_*.s) + 链接脚本(*.ld)。
 */
async function generateMakefile(projectDir, cfg) {
  const ioc = findIocFile(projectDir);
  if (!ioc) {
    bus.send('[生成] ✗ 工程目录下未找到 .ioc（STM32CubeMX 工程文件）', 'error');
    return { ok: false, error: 'no-ioc' };
  }
  const exe = (cfg.cubeMxPath || '').trim();
  if (!exe || !fs.existsSync(exe)) {
    bus.send(`[生成] ✗ 未找到 STM32CubeMX.exe（设置里「STM32CubeMX 路径」: ${exe || '空'}）`, 'error');
    return { ok: false, error: 'no-cubemx' };
  }
  const iocDir = path.dirname(ioc);
  bus.send(`[生成] 工程: ${ioc}`, 'step');
  bus.send('[生成] 调用 STM32CubeMX 命令行：切换工具链为 Makefile 并重新生成代码 …', 'info');
  // CubeMX 命令行脚本：加载 .ioc → 工具链切到 Makefile → 生成代码 → 退出
  const script = [
    `config load ${ioc}`,
    `project toolchain "Makefile"`,
    `project generate`,
    `exit`,
    ''
  ].join('\r\n');
  const scriptFile = path.join(app.getPath('temp'), `cubemx_gen_${Date.now()}.cubemx`);
  fs.writeFileSync(scriptFile, script, 'utf8');
  // -q <脚本> = 无界面执行脚本命令
  const code = await runProcess(exe, ['-q', scriptFile], { shell: false, clean: cleanCubeMx });
  try { fs.unlinkSync(scriptFile); } catch {}
  const mk = path.join(iocDir, 'Makefile');
  if (fs.existsSync(mk)) {
    // 中文工程名的 TARGET 不在此改写，由编译时 makeTargetOverrideArgs 以 TARGET= 覆盖处理
    bus.send('[生成] ✓ Makefile 已生成，现在可以编译/烧录了', 'success');
    return { ok: true, makefile: mk, dir: iocDir };
  }
  bus.send(`[生成] ✗ 未生成 Makefile (CubeMX exit ${code})。请确认 CubeMX 路径正确，且该芯片的固件包(如 STM32CubeF1)已安装`, 'error');
  return { ok: false, error: 'generate-failed', code };
}

/* ── 核心：编译（按工程类型分发 make / keil）───────────── */
async function compile(projectDir, cfg) {
  const sys = detectBuildSystem(projectDir, cfg);
  bus.send(`[编译] 目录: ${projectDir}`, 'step');
  bus.send(`[编译] 编译方式: ${sys === 'keil' ? 'Keil uVision5 (UV4)' : 'Makefile (GCC)'}`, 'info');
  return sys === 'keil' ? compileKeil(projectDir, cfg) : compileMake(projectDir, cfg);
}

// 解析 make 可执行文件的绝对路径（工具链目录 / 系统 PATH）；找不到返回 null
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

  bus.send('[编译] make -j4 ...', 'step');
  const makeCode = await runProcess(makeCmd, ['-j4', ...tgtArgs], { cwd: projectDir, env, shell: useShell, clean: cleanMake });
  if (makeCode === 0) {
    bus.send('[编译] ✓ 编译成功', 'success');
    return true;
  }
  bus.send(`[编译] ✗ 编译失败 (exit ${makeCode})`, 'error');
  return false;
}

// 运行 UV4 命令（-b/-z 编译 或 -f 烧录），把 -o 日志流式输出，返回 {code, log}
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
  const logFile = path.join(app.getPath('temp'), `uv4_${op}_${Date.now()}.txt`);
  // -j0 隐藏对话框；-o 把输出写到日志文件（UV4 不走 stdout）
  const cmdFlag = op === 'flash' ? '-f' : (cfg.keilRebuild ? '-z' : '-b');
  const args = [cmdFlag, proj, '-j0', '-o', logFile];
  bus.send(`[${op === 'flash' ? '烧录' : '编译'}] UV4 ${cmdFlag} "${path.basename(proj)}" ...`, 'step');
  // Keil 工程可能在子目录，cwd 用工程文件所在目录，以保证工程内相对路径正确
  const code = await runProcess(uv4, args, { cwd: path.dirname(proj), shell: false });
  let log = '';
  try { log = fs.readFileSync(logFile, 'utf8'); } catch {}
  if (log.trim()) {
    log.split(/\r?\n/).forEach((ln) => { if (ln.trim()) bus.send(ln.trimEnd()); });
  }
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

/* ── 核心：烧录（按 flashMethod 分发 pyocd / keil）──────── */
async function flash(projectDir, cfg) {
  const method = (cfg.flashMethod || 'pyocd');
  if (method === 'keil') return flashKeil(projectDir, cfg);
  if (method === 'openocd') return flashOpenocd(projectDir, cfg);
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
    capture: true
  });
  const code = result.code;
  if (code === 0) {
    bus.send('[烧录] ✓ 烧录成功，芯片已复位', 'success');
    return true;
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
  checkProbeInfo,
  readChipInfo,
  hardwareDebugCommand,
  normalizeDebugHex,
  parseDebugAddress,
  isFlashAddress,
  findKeilProject,
  findIocFile,
  detectBuildSystem,
  generateMakefile,
  compile,
  flash
};
