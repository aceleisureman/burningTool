const fs = require('fs');
const os = require('os');
const path = require('path');

function parseMakefileListVar(txt, name) {
  const lines = String(txt || '').split(/\r?\n/);
  const out = [];
  let active = false;
  for (const line of lines) {
    if (!active) {
      const m = line.match(new RegExp(`^\\s*${name}\\s*[+:?]?=\\s*(.*)$`));
      if (!m) continue;
      active = true;
      addListTokens(out, m[1]);
      if (!/\\\s*$/.test(line)) break;
      continue;
    }
    addListTokens(out, line);
    if (!/\\\s*$/.test(line)) break;
  }
  return out;
}

function addListTokens(out, text) {
  const clean = String(text || '')
    .replace(/#.*$/, '')
    .replace(/\\\s*$/, '')
    .trim();
  if (!clean) return;
  for (const token of clean.split(/\s+/)) {
    if (token) out.push(token);
  }
}

function parseMakefileAsmSources(txt) {
  return [
    ...parseMakefileListVar(txt, 'ASM_SOURCES'),
    ...parseMakefileListVar(txt, 'ASMM_SOURCES')
  ];
}

function cubeRepositoryRoots(extraRoots = []) {
  const home = os.homedir();
  return [
    ...extraRoots,
    path.join(home, 'STM32Cube', 'Repository'),
    path.join(home, 'STM32CubeMX', 'Repository'),
    path.join(home, '.stm32cubemx', 'Repository')
  ];
}

function findStartupTemplate(projectDir, filename, options = {}) {
  const deviceDir = startupDeviceDir(filename);
  if (deviceDir) {
    const localDirect = path.join(projectDir, 'Drivers', 'CMSIS', 'Device', 'ST', deviceDir, 'Source', 'Templates', 'gcc', filename);
    if (fs.existsSync(localDirect)) return localDirect;
  }

  const repoDirect = findRepositoryStartupTemplate(filename, options);
  if (repoDirect) return repoDirect;

  const local = findFile(path.join(projectDir, 'Drivers'), filename, (p) => /Source[/\\]Templates[/\\]gcc/i.test(p));
  if (local) return local;

  for (const root of cubeRepositoryRoots(options.repositoryRoots)) {
    const found = findFile(root, filename, (p) => /Source[/\\]Templates[/\\]gcc/i.test(p));
    if (found) return found;
  }
  return null;
}

function startupDeviceDir(filename) {
  const m = String(filename || '').match(/^startup_stm32([a-z]\d)/i);
  if (!m) return null;
  return `STM32${m[1].toUpperCase()}xx`;
}

function startupRepoFamily(filename) {
  const m = String(filename || '').match(/^startup_stm32([a-z]\d)/i);
  return m ? m[1].toUpperCase() : null;
}

function findRepositoryStartupTemplate(filename, options = {}) {
  const family = startupRepoFamily(filename);
  const deviceDir = startupDeviceDir(filename);
  if (!family || !deviceDir) return null;
  for (const root of cubeRepositoryRoots(options.repositoryRoots)) {
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    const packs = entries
      .filter((e) => e.isDirectory() && e.name.startsWith(`STM32Cube_FW_${family}_`))
      .map((e) => e.name)
      .sort()
      .reverse();
    for (const pack of packs) {
      const p = path.join(root, pack, 'Drivers', 'CMSIS', 'Device', 'ST', deviceDir, 'Source', 'Templates', 'gcc', filename);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function findFile(root, filename, prefer) {
  if (!root || !fs.existsSync(root)) return null;
  const queue = [root];
  let fallback = null;
  while (queue.length) {
    const dir = queue.shift();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && e.name !== 'node_modules') queue.push(p);
      } else if (e.isFile() && e.name.toLowerCase() === filename.toLowerCase()) {
        if (!fallback) fallback = p;
        if (!prefer || prefer(p)) return p;
      }
    }
  }
  return fallback;
}

function ensureMakefileStartupSources(projectDir, options = {}) {
  const makefile = path.join(projectDir, 'Makefile');
  let txt;
  try { txt = fs.readFileSync(makefile, 'utf8'); } catch { return { created: [], missing: [] }; }

  const startupSources = parseMakefileAsmSources(txt)
    .filter((src) => /^startup_.*\.s$/i.test(path.basename(src)));
  const created = [];
  const missing = [];
  const failed = [];

  for (const src of startupSources) {
    const dest = path.join(projectDir, src);
    if (fs.existsSync(dest)) continue;
    const filename = path.basename(src);
    const template = findStartupTemplate(projectDir, filename, options);
    if (!template) {
      missing.push(src);
      continue;
    }
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(template, dest);
      created.push(src);
    } catch {
      failed.push(src);
    }
  }
  return { created, missing, failed };
}

module.exports = {
  parseMakefileAsmSources,
  ensureMakefileStartupSources,
  findStartupTemplate
};
