'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');

/**
 * 检查文件是否存在（静默失败）
 */
function existsFile(p) {
  try { return !!(p && fs.existsSync(p)); } catch { return false; }
}

/**
 * 用系统命令查找可执行文件（避免 PATH 含网络路径时 fs.existsSync 阻塞）
 * @param {string} name - 可执行文件名
 * @param {number} timeoutMs - 超时毫秒（默认 4000）
 * @returns {string|null} 找到的完整路径，否则 null
 */
function whichSync(name, timeoutMs = 4000) {
  const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    const out = execFileSync(cmd, [name], {
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const first = (out || '').split(/\r?\n/).find((l) => l.trim());
    if (first) return first.trim();
  } catch { /* not found or timeout */ }
  return null;
}

module.exports = { existsFile, whichSync };
