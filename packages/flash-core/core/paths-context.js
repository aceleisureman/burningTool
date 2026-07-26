// 可注入的路径上下文：桌面端用 Electron app.getPath，VS Code 扩展用 globalStorage。
// 领域代码禁止直接 require('electron')。
const os = require('os');
const path = require('path');

let _ctx = null;

/**
 * @param {object} next
 * @param {string|(() => string)} [next.tempDir]
 * @param {string|(() => string)} [next.userDataDir]
 * @param {string|(() => string)} [next.toolchainRoot]
 * @param {string|(() => string)} [next.toolsDir]
 * @param {string|(() => string)} [next.appInstallRoot]
 * @param {boolean|(() => boolean)} [next.isPackaged]
 */
function setPathsContext(next = {}) {
  _ctx = next && typeof next === 'object' ? next : null;
}

function resolveField(value, fallback) {
  if (typeof value === 'function') {
    try {
      const v = value();
      if (v != null && v !== '') return v;
    } catch {
      /* fall through */
    }
    return fallback;
  }
  if (value != null && value !== '') return value;
  return fallback;
}

function defaultUserDataDir() {
  return path.join(os.homedir() || process.cwd(), '.mcu-toolbox');
}

function getPathsContext() {
  const c = _ctx || {};
  const userDataDir = resolveField(c.userDataDir, defaultUserDataDir());
  const appInstallRoot = resolveField(c.appInstallRoot, process.cwd());
  const isPackaged = !!resolveField(c.isPackaged, false);
  return {
    tempDir: resolveField(c.tempDir, os.tmpdir()),
    userDataDir,
    toolsDir: resolveField(c.toolsDir, path.join(userDataDir, 'tools')),
    toolchainRoot: resolveField(c.toolchainRoot, ''),
    appInstallRoot,
    isPackaged
  };
}

module.exports = {
  setPathsContext,
  getPathsContext
};
