'use strict';

const fs = require('fs');
const path = require('path');
const { getExtensionStorageRoot } = require('./toolchainShare');

const MAX_RECENT = 12;

function storagePath() {
  return path.join(getExtensionStorageRoot(), 'recent-projects.json');
}

function normalizeRecentProjects(list) {
  return (list || [])
    .map((dir) => String(dir || '').trim())
    .filter(Boolean)
    .filter((dir, index, items) => items.indexOf(dir) === index)
    .slice(0, MAX_RECENT);
}

function readStore() {
  const filePath = storagePath();
  try {
    if (!fs.existsSync(filePath)) return { filePath, recentProjects: [] };
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      filePath,
      recentProjects: normalizeRecentProjects(data && data.recentProjects)
    };
  } catch (error) {
    return { filePath, recentProjects: [], error };
  }
}

function writeStore(filePath, recentProjects) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const data = { version: 1, recentProjects: normalizeRecentProjects(recentProjects) };
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try { fs.unlinkSync(tempPath); } catch { /* ignore cleanup failure */ }
    throw error;
  }
  return data.recentProjects;
}

function listRecentProjects() {
  return readStore().recentProjects;
}

function saveRecentProjects(list) {
  const { filePath, error } = readStore();
  if (error) throw new Error(`Invalid recent project store: ${filePath}`);
  return writeStore(filePath, list);
}

function updateRecentProjects(change) {
  const { filePath, recentProjects, error } = readStore();
  if (error) throw new Error(`Invalid recent project store: ${filePath}`);
  const next = normalizeRecentProjects(change(recentProjects));
  if (JSON.stringify(next) === JSON.stringify(recentProjects)) return recentProjects;
  return writeStore(filePath, next);
}

function addRecentProject(dir) {
  const value = String(dir || '').trim();
  if (!value) return listRecentProjects();
  return updateRecentProjects((list) => [value, ...list.filter((item) => item !== value)]);
}

function removeRecentProject(dir) {
  const value = String(dir || '').trim();
  if (!value) return listRecentProjects();
  return updateRecentProjects((list) => list.filter((item) => item !== value));
}

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
  storagePath,
  listRecentProjects,
  listRecentProjectInfos,
  addRecentProject,
  removeRecentProject,
  saveRecentProjects
};
