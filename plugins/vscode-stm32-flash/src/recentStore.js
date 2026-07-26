'use strict';

const fs = require('fs');
const path = require('path');
const { findDesktopUserData } = require('./toolchainShare');

const MAX_RECENT = 12;

function configPath() {
  return path.join(findDesktopUserData(), 'config.json');
}

function readDesktopConfigFile() {
  const p = configPath();
  try {
    if (!fs.existsSync(p)) return { path: p, data: {} };
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { path: p, data: data && typeof data === 'object' ? data : {} };
  } catch {
    return { path: p, data: {} };
  }
}

function writeDesktopConfigFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

/**
 * 读取与 MCU 工具箱共用的历史工程列表（最新在前）
 * @returns {string[]}
 */
function listRecentProjects() {
  const { data } = readDesktopConfigFile();
  const list = Array.isArray(data.recentProjects) ? data.recentProjects : [];
  return list
    .map((d) => String(d || '').trim())
    .filter(Boolean)
    .filter((d, i, arr) => arr.indexOf(d) === i)
    .slice(0, MAX_RECENT);
}

/**
 * 写入历史列表到桌面端 config.json（与 MCU 工具箱互通）
 * @param {string[]} list
 */
function saveRecentProjects(list) {
  const { path: filePath, data } = readDesktopConfigFile();
  const next = (list || [])
    .map((d) => String(d || '').trim())
    .filter(Boolean)
    .filter((d, i, arr) => arr.indexOf(d) === i)
    .slice(0, MAX_RECENT);
  data.recentProjects = next;
  writeDesktopConfigFile(filePath, data);
  return next;
}

/**
 * 置顶添加历史（与桌面 addRecent 行为一致）
 * @param {string} dir
 */
function addRecentProject(dir) {
  const d = String(dir || '').trim();
  if (!d) return listRecentProjects();
  const list = listRecentProjects();
  if (list[0] === d) return list;
  return saveRecentProjects([d, ...list.filter((x) => x !== d)]);
}

/**
 * @param {string} dir
 */
function removeRecentProject(dir) {
  const d = String(dir || '').trim();
  if (!d) return listRecentProjects();
  return saveRecentProjects(listRecentProjects().filter((x) => x !== d));
}

/**
 * 供 UI 展示：带是否存在、显示名
 */
function listRecentProjectInfos() {
  return listRecentProjects().map((dir) => {
    let exists = false;
    try { exists = fs.existsSync(dir); } catch { exists = false; }
    return {
      dir,
      name: path.basename(dir) || dir,
      parent: path.dirname(dir),
      exists
    };
  });
}

module.exports = {
  MAX_RECENT,
  configPath,
  listRecentProjects,
  listRecentProjectInfos,
  addRecentProject,
  removeRecentProject,
  saveRecentProjects
};
