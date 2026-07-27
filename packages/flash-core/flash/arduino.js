// Arduino 工程识别 + arduino-cli 编译/烧录。
const path = require('path');
const fs = require('fs');
const bus = require('../core/bus');
const { runProcess, runCapture } = require('../toolchain/proc');
const { findExecutableOnPath } = require('../toolchain/paths');

function clean(s) {
  return String(s || '').trim();
}

/**
 * 查找 Arduino 草图：
 * 1) 目录名/同名 .ino（标准结构 Foo/Foo.ino）
 * 2) 目录下任意 .ino
 * 3) 浅层子目录（depth<=2）
 */
function findArduinoSketch(projectDir) {
  if (!projectDir || !fs.existsSync(projectDir)) return null;
  const base = path.basename(projectDir);
  const preferred = path.join(projectDir, `${base}.ino`);
  if (fs.existsSync(preferred)) {
    return { sketchDir: projectDir, sketchFile: preferred, name: base };
  }

  try {
    const entries = fs.readdirSync(projectDir, { withFileTypes: true });
    const ino = entries.find((e) => e.isFile() && e.name.toLowerCase().endsWith('.ino'));
    if (ino) {
      return {
        sketchDir: projectDir,
        sketchFile: path.join(projectDir, ino.name),
        name: path.basename(ino.name, path.extname(ino.name))
      };
    }
  } catch {
    /* ignore */
  }

  // 浅层搜索：支持 monorepo 工作区根打开、草图在子目录
  const queue = [{ dir: projectDir, d: 0 }];
  while (queue.length) {
    const { dir, d } = queue.shift();
    if (d >= 2) continue;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    // 标准结构：子目录名 == ino 名
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'build') continue;
      const child = path.join(dir, e.name);
      const candidate = path.join(child, `${e.name}.ino`);
      if (fs.existsSync(candidate)) {
        return { sketchDir: child, sketchFile: candidate, name: e.name };
      }
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'build') continue;
      queue.push({ dir: path.join(dir, e.name), d: d + 1 });
    }
  }
  return null;
}

function isArduinoProject(projectDir) {
  return !!findArduinoSketch(projectDir);
}

function resolveArduinoCli(cfg = {}) {
  const configured = clean(cfg.arduinoCliPath);
  if (configured) {
    if (!configured.includes(path.sep) || fs.existsSync(configured)) return configured;
  }
  const isWin = process.platform === 'win32';
  return (
    findExecutableOnPath(isWin ? 'arduino-cli.exe' : 'arduino-cli')
    || findExecutableOnPath('arduino-cli')
    || ''
  );
}

async function arduinoCliStatus(cfg = {}) {
  const bin = resolveArduinoCli(cfg);
  if (!bin) {
    return {
      ok: false,
      error: '未找到 arduino-cli。请安装：https://arduino.github.io/arduino-cli/ 或 brew install arduino-cli'
    };
  }
  try {
    const r = await runCapture(bin, ['version'], { shell: false, timeoutMs: 8000 });
    const text = String(r.out || '').trim();
    if (r.code === 0 || /arduino-cli/i.test(text)) {
      return {
        ok: true,
        command: bin,
        version: text.split(/\r?\n/).find(Boolean) || 'arduino-cli'
      };
    }
    return { ok: false, error: `arduino-cli 不可用: ${bin}`, command: bin };
  } catch (e) {
    return { ok: false, error: e.message || String(e), command: bin };
  }
}

function fqbnFromCfg(cfg = {}) {
  // 优先完整 FQBN；否则用 arduinoBoard 兼容字段
  const fqbn = clean(cfg.arduinoFqbn || cfg.arduinoBoard);
  return fqbn || 'arduino:avr:uno';
}

function buildExtraFlags(cfg = {}) {
  const flags = [];
  if (cfg.arduinoVerbose) flags.push('--verbose');
  // 额外传给 arduino-cli 的参数（空格分隔）
  const extra = clean(cfg.arduinoExtraArgs);
  if (extra) {
    // 简单拆分，支持引号
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let m;
    while ((m = re.exec(extra))) flags.push(m[1] || m[2] || m[3]);
  }
  return flags;
}

/**
 * 编译 Arduino 草图
 * @returns {Promise<boolean>}
 */
async function compileArduino(projectDir, cfg = {}) {
  const sketch = findArduinoSketch(projectDir);
  if (!sketch) {
    bus.send('[Arduino] ✗ 未找到 .ino 草图（需要 Foo/Foo.ino 或目录内 .ino）', 'error');
    return false;
  }
  const status = await arduinoCliStatus(cfg);
  if (!status.ok) {
    bus.send(`[Arduino] ✗ ${status.error}`, 'error');
    return false;
  }
  const fqbn = fqbnFromCfg(cfg);
  const buildPath = path.join(sketch.sketchDir, 'build', 'arduino-cli');
  try { fs.mkdirSync(buildPath, { recursive: true }); } catch {}

  bus.send(`[Arduino] 草图: ${sketch.sketchFile}`, 'info');
  bus.send(`[Arduino] FQBN: ${fqbn}`, 'info');
  bus.send(`[Arduino] arduino-cli: ${status.command}`, 'info');
  bus.send('[Arduino] compile ...', 'step');

  const args = [
    'compile',
    '--fqbn', fqbn,
    '--build-path', buildPath,
    ...buildExtraFlags(cfg),
    sketch.sketchDir
  ];
  const code = await runProcess(status.command, args, {
    cwd: sketch.sketchDir,
    shell: false
  });
  if (code === 0) {
    bus.send('[Arduino] ✓ 编译成功', 'success');
    const fw = resolveArduinoFirmware(projectDir, cfg, sketch);
    if (fw) bus.send(`[Arduino] 固件: ${fw}`, 'info');
    return true;
  }
  bus.send(`[Arduino] ✗ 编译失败 (exit ${code})`, 'error');
  return false;
}

/**
 * 查找 arduino-cli 产物
 */
function resolveArduinoFirmware(projectDir, cfg = {}, sketchInfo) {
  const sketch = sketchInfo || findArduinoSketch(projectDir);
  if (!sketch) return null;
  const buildPath = path.join(sketch.sketchDir, 'build', 'arduino-cli');
  const name = sketch.name;
  const candidates = [
    path.join(buildPath, `${name}.ino.hex`),
    path.join(buildPath, `${name}.ino.bin`),
    path.join(buildPath, `${name}.ino.elf`),
    path.join(buildPath, `${name}.hex`),
    path.join(buildPath, `${name}.bin`),
    path.join(buildPath, `${name}.elf`)
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  // 扫 build 目录
  try {
    if (fs.existsSync(buildPath)) {
      const files = fs.readdirSync(buildPath);
      const hex = files.find((f) => f.endsWith('.hex'));
      if (hex) return path.join(buildPath, hex);
      const bin = files.find((f) => f.endsWith('.bin'));
      if (bin) return path.join(buildPath, bin);
      const elf = files.find((f) => f.endsWith('.elf'));
      if (elf) return path.join(buildPath, elf);
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * 烧录 Arduino（arduino-cli upload）
 * 需要 cfg.arduinoPort 或 cfg.esp32Config.portPath 兼容串口字段
 */
async function flashArduino(projectDir, cfg = {}) {
  const sketch = findArduinoSketch(projectDir);
  if (!sketch) {
    bus.send('[Arduino] ✗ 未找到 .ino 草图', 'error');
    return false;
  }
  const status = await arduinoCliStatus(cfg);
  if (!status.ok) {
    bus.send(`[Arduino] ✗ ${status.error}`, 'error');
    return false;
  }
  const fqbn = fqbnFromCfg(cfg);
  const port = clean(cfg.arduinoPort || cfg.portPath || (cfg.esp32Config && cfg.esp32Config.portPath));
  if (!port) {
    bus.send('[Arduino] ✗ 未指定串口（设置 arduinoPort，如 /dev/cu.usbserial-* 或 COM3）', 'error');
    return false;
  }
  const buildPath = path.join(sketch.sketchDir, 'build', 'arduino-cli');
  // 若无产物则先编译
  if (!resolveArduinoFirmware(projectDir, cfg, sketch)) {
    bus.send('[Arduino] 未找到编译产物，先执行 compile ...', 'info');
    const ok = await compileArduino(projectDir, cfg);
    if (!ok) return false;
  }

  bus.send(`[Arduino] 上传: ${sketch.name} → ${port}`, 'step');
  bus.send(`[Arduino] FQBN: ${fqbn}`, 'info');
  const args = [
    'upload',
    '--fqbn', fqbn,
    '--port', port,
    '--build-path', buildPath,
    ...buildExtraFlags(cfg),
    sketch.sketchDir
  ];
  const code = await runProcess(status.command, args, {
    cwd: sketch.sketchDir,
    shell: false
  });
  if (code === 0) {
    bus.send('[Arduino] ✓ 烧录成功', 'success');
    return true;
  }
  bus.send(`[Arduino] ✗ 烧录失败 (exit ${code})`, 'error');
  return false;
}

module.exports = {
  findArduinoSketch,
  isArduinoProject,
  resolveArduinoCli,
  arduinoCliStatus,
  compileArduino,
  flashArduino,
  resolveArduinoFirmware,
  fqbnFromCfg
};
