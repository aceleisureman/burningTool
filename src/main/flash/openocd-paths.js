const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

function quoteOpenocdTclPath(filePath) {
  const normalized = String(filePath).replace(/\\/g, '/');
  if (!/[{}\r\n]/.test(normalized)) return `{${normalized}}`;
  return `"${normalized.replace(/["$[\]\\\r\n]/g, (ch) => `\\${ch}`)}"`;
}

function needsOpenocdAsciiStaging(filePath, platform = process.platform) {
  return platform === 'win32' && /^[A-Za-z]:[\\/]/.test(String(filePath));
}

function ensureWritableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return dir;
  } catch {
    return null;
  }
}

function resolveOpenocdStagingDir() {
  const candidates = [];
  if (process.platform === 'win32') {
    const systemDrive = (process.env.SystemDrive || '').trim();
    if (/^[A-Za-z]:$/.test(systemDrive)) candidates.push(path.join(`${systemDrive}\\`, 'mcu-toolbox-openocd'));
    const cwdRoot = path.parse(process.cwd()).root;
    if (cwdRoot) candidates.push(path.join(cwdRoot, 'mcu-toolbox-openocd'));
  }
  candidates.push(path.join(os.tmpdir(), 'mcu-toolbox-openocd'));

  for (const dir of [...new Set(candidates)]) {
    const writable = ensureWritableDir(dir);
    if (writable) return writable;
  }
  return null;
}

function prepareOpenocdFirmwarePath(firmware) {
  if (!needsOpenocdAsciiStaging(firmware)) return { filePath: firmware, staged: false };

  const dir = resolveOpenocdStagingDir();
  if (!dir) return { filePath: firmware, staged: false };

  const ext = path.extname(firmware) || '.elf';
  const hash = crypto.createHash('sha1').update(firmware).digest('hex').slice(0, 12);
  const stagedPath = path.join(dir, `firmware-${hash}${ext}`);
  fs.copyFileSync(firmware, stagedPath);
  return { filePath: stagedPath, staged: true };
}

module.exports = {
  quoteOpenocdTclPath,
  needsOpenocdAsciiStaging,
  prepareOpenocdFirmwarePath
};
