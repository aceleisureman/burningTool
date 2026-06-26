// 固件分析：解析 ELF/AXF/MAP，输出 Flash/RAM 占用、段大小和最大符号。
const path = require('path');
const fs = require('fs');
const { runCapture } = require('../toolchain/proc');
const { effectivePaths, findExecutableOnPath } = require('../toolchain/toolchain');

const FLASH_SECTIONS = new Set(['.isr_vector', '.text', '.rodata', '.init', '.fini', '.ARM.extab', '.ARM.exidx']);
const RAM_SECTIONS = new Set(['.data', '.bss', '.noinit', '.ramfunc', '.ccmram']);

function findFirmwareFile(projectDir, explicitName) {
  if (!projectDir || !fs.existsSync(projectDir)) return '';
  const exts = new Set(['.elf', '.axf']);
  const roots = [path.join(projectDir, 'build'), projectDir];
  if (explicitName) {
    for (const root of roots) {
      const p = path.join(root, explicitName);
      if (fs.existsSync(p) && exts.has(path.extname(p).toLowerCase())) return p;
    }
  }
  const found = [];
  const stack = roots.filter((d, i) => fs.existsSync(d) && roots.indexOf(d) === i).map((dir) => ({ dir, d: 0 }));
  while (stack.length) {
    const { dir, d } = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isFile() && exts.has(path.extname(e.name).toLowerCase())) found.push(p);
      if (e.isDirectory() && d < 4 && e.name !== 'node_modules' && !e.name.startsWith('.')) stack.push({ dir: p, d: d + 1 });
    }
  }
  if (!found.length) return '';
  found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return found[0];
}

function findMapFile(projectDir, firmware) {
  const candidates = [];
  if (firmware) candidates.push(firmware.replace(/\.(elf|axf)$/i, '.map'));
  if (projectDir) candidates.push(path.join(projectDir, 'build', 'firmware.map'));
  for (const p of candidates) if (p && fs.existsSync(p)) return p;
  if (!projectDir || !fs.existsSync(projectDir)) return '';
  const found = [];
  const stack = [{ dir: projectDir, d: 0 }];
  while (stack.length) {
    const { dir, d } = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isFile() && e.name.toLowerCase().endsWith('.map')) found.push(p);
      if (e.isDirectory() && d < 4 && e.name !== 'node_modules' && !e.name.startsWith('.')) stack.push({ dir: p, d: d + 1 });
    }
  }
  found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return found[0] || '';
}

function resolveBinutil(cfg, name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const eff = effectivePaths(cfg || {});
  const dirs = [eff.armGccPath, path.dirname(eff.armGccPath || '')].filter(Boolean);
  for (const dir of dirs) {
    const p = path.join(dir, exe);
    if (fs.existsSync(p)) return p;
  }
  return findExecutableOnPath(exe) || '';
}

function parseSizeA(output) {
  const sections = [];
  for (const line of String(output || '').split(/\r?\n/)) {
    const m = line.trim().match(/^(\S+)\s+(\d+)\s+([0-9a-fA-Fx]+)$/);
    if (!m || m[1] === 'section') continue;
    sections.push({ name: m[1], size: Number(m[2]) || 0, address: m[3] });
  }
  const flashUsed = sections.filter((s) => FLASH_SECTIONS.has(s.name)).reduce((n, s) => n + s.size, 0);
  const ramUsed = sections.filter((s) => RAM_SECTIONS.has(s.name)).reduce((n, s) => n + s.size, 0);
  return { sections, flashUsed, ramUsed };
}

function parseNmSizeSort(output, limit = 20) {
  const symbols = [];
  for (const line of String(output || '').split(/\r?\n/)) {
    const m = line.trim().match(/^([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+([A-Za-z])\s+(.+)$/);
    if (!m) continue;
    symbols.push({ address: `0x${m[1]}`, size: parseInt(m[2], 16) || 0, type: m[3], name: m[4].trim() });
  }
  symbols.sort((a, b) => b.size - a.size);
  return symbols.slice(0, limit);
}

function parseMapMemoryConfig(text) {
  const regions = [];
  const lines = String(text || '').split(/\r?\n/);
  const start = lines.findIndex((l) => /^Memory Configuration/i.test(l.trim()));
  if (start < 0) return regions;
  for (let i = start + 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) break;
    const m = line.match(/^(\S+)\s+(0x[0-9a-fA-F]+)\s+(0x[0-9a-fA-F]+|\d+)\s+(\S+)/);
    if (m) regions.push({ name: m[1], origin: m[2], length: parseInt(m[3], 0) || 0, attrs: m[4] });
  }
  return regions;
}

function formatBytes(n) {
  n = Number(n) || 0;
  if (n >= 1048576) return `${(n / 1048576).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function enrichUsage(used, total) {
  return { used, total: total || 0, percent: total ? Math.min(100, Math.round(used * 1000 / total) / 10) : 0, label: formatBytes(used) };
}

async function analyzeFirmware(projectDir, cfg = {}) {
  const firmware = findFirmwareFile(projectDir, cfg.elfName);
  if (!firmware) return { ok: false, error: '未找到 .elf/.axf 固件，请先编译工程' };
  const mapFile = findMapFile(projectDir, firmware);
  const sizeBin = resolveBinutil(cfg, 'arm-none-eabi-size');
  const nmBin = resolveBinutil(cfg, 'arm-none-eabi-nm');

  let sections = [];
  let flashUsed = 0;
  let ramUsed = 0;
  let symbols = [];
  if (sizeBin) {
    const r = await runCapture(sizeBin, ['-A', firmware], { shell: false, timeoutMs: 12000 });
    if (r.code === 0) ({ sections, flashUsed, ramUsed } = parseSizeA(r.out));
  }
  if (nmBin) {
    const r = await runCapture(nmBin, ['--print-size', '--size-sort', '--radix=d', firmware], { shell: false, timeoutMs: 12000 });
    if (r.code === 0) symbols = parseNmSizeSort(r.out, 24);
  }

  let regions = [];
  if (mapFile) {
    try { regions = parseMapMemoryConfig(fs.readFileSync(mapFile, 'utf8')); } catch {}
  }
  const flashRegion = regions.find((r) => /flash|rom/i.test(r.name)) || regions.find((r) => /rx/i.test(r.attrs));
  const ramRegion = regions.find((r) => /ram|sram|ccm/i.test(r.name)) || regions.find((r) => /xrw|rw/i.test(r.attrs));

  return {
    ok: true,
    firmware,
    firmwareName: path.basename(firmware),
    firmwareSize: fs.statSync(firmware).size,
    mapFile,
    tools: { size: sizeBin, nm: nmBin },
    flash: enrichUsage(flashUsed, flashRegion && flashRegion.length),
    ram: enrichUsage(ramUsed, ramRegion && ramRegion.length),
    sections: sections.sort((a, b) => b.size - a.size).slice(0, 32),
    symbols,
    regions
  };
}

module.exports = {
  findFirmwareFile,
  findMapFile,
  parseSizeA,
  parseNmSizeSort,
  parseMapMemoryConfig,
  formatBytes,
  analyzeFirmware
};
