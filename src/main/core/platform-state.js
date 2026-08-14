'use strict';
/*
 * 分平台独立状态（platformState）：
 * 工具链可执行文件路径已由 flash-core 的 platformPaths 隔离；
 * 这里补充隔离其余“机器相关”字段，避免在 Windows/macOS 间切换时互相覆盖：
 *   - 顶层：toolchainRootPath、windowBounds、floatBounds、recentProjects
 *   - stc51Config：portPath、firmwarePath、eepromPath
 *   - esp32Config：portPath、firmwarePath、parts
 * 结构：cfg.platformState = { windows|macos|linux: { ...顶层字段, stc51Config: {...}, esp32Config: {...} } }
 */

const PLATFORM_STATE_SPEC = {
  '': ['toolchainRootPath', 'windowBounds', 'floatBounds', 'recentProjects'],
  stc51Config: ['portPath', 'firmwarePath', 'eepromPath'],
  esp32Config: ['portPath', 'firmwarePath', 'parts']
};

// 这些字段是路径/串口号，明显属于另一平台时（首次在本平台使用旧配置）直接清空
const PATHLIKE_KEYS = new Set(['toolchainRootPath', 'portPath', 'firmwarePath', 'eepromPath']);
const WINDOWS_PATH_RE = /^[a-z]:[\\/]/i;

function looksLikeOtherPlatformPath(value, platformId) {
  if (typeof value !== 'string' || !value) return false;
  if (platformId === 'windows') return value.startsWith('/');
  return WINDOWS_PATH_RE.test(value) || /^com\d+$/i.test(value);
}

function sanitizeValue(key, value, platformId) {
  if (key === 'recentProjects') {
    return Array.isArray(value) ? value.filter((d) => !looksLikeOtherPlatformPath(d, platformId)) : [];
  }
  if (PATHLIKE_KEYS.has(key) && looksLikeOtherPlatformPath(value, platformId)) return '';
  return value;
}

function snapshotPlatformState(cfg) {
  const snap = {};
  for (const [section, keys] of Object.entries(PLATFORM_STATE_SPEC)) {
    const src = (section ? cfg[section] : cfg) || {};
    const out = section ? (snap[section] = {}) : snap;
    for (const key of keys) out[key] = src[key];
  }
  return snap;
}

/*
 * 载入路径：以 platformState[platformId] 快照为准覆盖顶层字段（快照优先），
 * 没有快照的键（旧配置首次在本平台加载）对顶层值做跨平台清洗，最后回写快照。
 */
function applyPlatformState(cfg, platformId) {
  const next = Object.assign({}, cfg);
  const all = Object.assign({}, next.platformState || {});
  const saved = all[platformId] || null;

  for (const [section, keys] of Object.entries(PLATFORM_STATE_SPEC)) {
    const target = section ? (next[section] = Object.assign({}, next[section] || {})) : next;
    const savedSection = saved ? (section ? saved[section] : saved) : null;
    for (const key of keys) {
      if (savedSection && Object.prototype.hasOwnProperty.call(savedSection, key)) {
        target[key] = savedSection[key];
      } else {
        target[key] = sanitizeValue(key, target[key], platformId);
      }
    }
  }
  all[platformId] = snapshotPlatformState(next);
  next.platformState = all;
  return next;
}

/*
 * 保存路径：先把合并后的最新值写入当前平台快照（当前值优先），
 * 再走 applyPlatformState 时快照与顶层已一致，不会用旧快照覆盖新值。
 */
function mergeCurrentPlatformState(cfg, platformId) {
  const next = Object.assign({}, cfg);
  const all = Object.assign({}, next.platformState || {});
  all[platformId] = snapshotPlatformState(next);
  next.platformState = all;
  return next;
}

module.exports = {
  PLATFORM_STATE_SPEC,
  applyPlatformState,
  mergeCurrentPlatformState,
  snapshotPlatformState
};
