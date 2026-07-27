// Keil/CubeMX 工程识别、固件定位和 Makefile 生成。
const path = require('path');
const fs = require('fs');
const bus = require('../core/bus');
const { getPathsContext } = require('../core/paths-context');
const { runProcess } = require('../toolchain/proc');
const { asciiTargetName, cleanCubeMx } = require('./flash-parsing');
const { KEIL_SUPPORTED } = require('../core/env');

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

const { findArduinoSketch, isArduinoProject } = require('./arduino');

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

function detectBuildSystem(projectDir, cfg, keilProj) {
  const mode = (cfg && cfg.buildSystem) || 'auto';
  if (mode === 'arduino') return 'arduino';
  if (mode === 'make') {
    // 设置固定为 make 但目录无 Makefile 且识别到 Keil 工程时，自动切换到 Keil 编译
    if (KEIL_SUPPORTED && !fs.existsSync(path.join(projectDir, 'Makefile'))
        && (keilProj !== undefined ? keilProj : findKeilProject(projectDir))) {
      bus.send('[编译] 未找到 Makefile，但识别到 Keil 工程，自动切换为 Keil 编译方式', 'info');
      return 'keil';
    }
    return 'make';
  }
  if (mode === 'keil') return KEIL_SUPPORTED ? 'keil' : 'make';
  // auto：Keil 优先 → Arduino(.ino) → Makefile → 默认 make
  if (KEIL_SUPPORTED && (keilProj !== undefined ? keilProj : findKeilProject(projectDir))) return 'keil';
  if (isArduinoProject(projectDir)) return 'arduino';
  if (fs.existsSync(path.join(projectDir, 'Makefile'))) return 'make';
  return 'make';
}

function resolveFirmware(projectDir, cfg) {
  // Arduino 产物优先
  try {
    const { resolveArduinoFirmware } = require('./arduino');
    const arduinoFw = resolveArduinoFirmware(projectDir, cfg);
    if (arduinoFw) return arduinoFw;
  } catch {
    /* ignore */
  }
  const buildDir = path.join(projectDir, 'build');
  if (cfg.elfName) {
    const p = path.join(buildDir, cfg.elfName);
    if (fs.existsSync(p)) return p;
  }
  const exts = ['.elf', '.axf', '.hex', '.bin'];
  // 1) 优先 build/ 目录
  if (fs.existsSync(buildDir)) {
    const cands = fs.readdirSync(buildDir).filter((f) => exts.includes(path.extname(f).toLowerCase()));
    if (cands.length) {
      const preferred = cands.find((f) => f === 'classroom_ctrl.elf')
        || cands.find((f) => path.extname(f).toLowerCase() === '.elf')
        || cands.find((f) => path.extname(f).toLowerCase() === '.axf')
        || cands.find((f) => path.extname(f).toLowerCase() === '.hex')
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
  const scriptFile = path.join(getPathsContext().tempDir, `cubemx_gen_${Date.now()}.cubemx`);
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

module.exports = {
  findKeilProject,
  findIocFile,
  makeTargetOverrideArgs,
  detectBuildSystem,
  resolveFirmware,
  generateMakefile,
  findArduinoSketch: (...a) => require('./arduino').findArduinoSketch(...a),
  isArduinoProject: (...a) => require('./arduino').isArduinoProject(...a)
};
