'use strict';

const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const {
  findKeilProject,
  findIocFile,
  detectBuildSystem
} = require('../vendor/flash-core');
const { loadFlashConfig, getConfiguredProjectDir, setProjectDir } = require('./config');

/**
 * @param {string} dir
 */
function detectProject(dir, cfg) {
  if (!dir || !fs.existsSync(dir)) {
    return {
      exists: false,
      dir: dir || '',
      hasMakefile: false,
      hasKeil: false,
      keilProject: '',
      hasIoc: false,
      iocFile: '',
      buildSystem: null,
      projectValid: false,
      projectKind: 'none',
      projectKindLabel: '未选择工程',
      source: ''
    };
  }
  const hasMakefile = fs.existsSync(path.join(dir, 'Makefile'));
  const keilProj = findKeilProject(dir);
  const iocFile = findIocFile(dir);
  const hasKeil = !!keilProj;
  const hasIoc = !!iocFile;
  const buildSystem = detectBuildSystem(dir, cfg || loadFlashConfig(), keilProj);

  let projectKind = 'unknown';
  let projectKindLabel = '未识别工程';
  if (hasMakefile && hasKeil) {
    projectKind = 'makefile+keil';
    projectKindLabel = 'Keil + Makefile 混合工程';
  } else if (hasKeil) {
    projectKind = 'keil';
    projectKindLabel = 'Keil 工程';
  } else if (hasMakefile) {
    projectKind = 'makefile';
    projectKindLabel = 'Makefile / GCC 工程';
  } else if (hasIoc) {
    projectKind = 'cubemx';
    projectKindLabel = 'CubeMX 工程（需生成 Makefile）';
  }

  return {
    exists: true,
    dir,
    hasMakefile,
    hasKeil,
    keilProject: keilProj ? path.relative(dir, keilProj) || path.basename(keilProj) : '',
    hasIoc,
    iocFile: iocFile ? path.relative(dir, iocFile) || path.basename(iocFile) : '',
    buildSystem,
    projectValid: !!(hasMakefile || keilProj),
    projectKind,
    projectKindLabel,
    source: ''
  };
}

/**
 * 当前 VS Code 已打开的工作区根目录。
 * 多根工作区时：优先当前活动编辑器所在文件夹，否则取第一个。
 * @returns {string}
 */
function getActiveWorkspaceDir() {
  const folders = vscode.workspace.workspaceFolders || [];
  if (!folders.length) return '';

  const activeUri = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document
    ? vscode.window.activeTextEditor.document.uri
    : null;
  if (activeUri && (activeUri.scheme === 'file' || activeUri.scheme === 'vscode-remote')) {
    try {
      const wf = vscode.workspace.getWorkspaceFolder(activeUri);
      if (wf) return wf.uri.fsPath;
    } catch {
      /* ignore */
    }
  }
  return folders[0].uri.fsPath;
}

/**
 * 在工作区根或其一级子目录中定位 STM32 工程目录。
 * 找不到特征文件时仍返回工作区根（作为当前打开的工程）。
 * @param {string} workspaceRoot
 */
function resolveProjectInWorkspace(workspaceRoot) {
  if (!workspaceRoot) return '';
  const rootInfo = detectProject(workspaceRoot);
  if (rootInfo.projectValid || rootInfo.hasIoc) return workspaceRoot;

  try {
    const entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
      const sub = path.join(workspaceRoot, e.name);
      const subInfo = detectProject(sub);
      if (subInfo.projectValid || subInfo.hasIoc) return sub;
    }
  } catch {
    /* ignore */
  }
  // 用户当前打开的就是该工程目录（即使尚未生成 Makefile）
  return workspaceRoot;
}

/**
 * 解析当前应使用的工程目录：
 * 1. 优先：VS Code 当前打开的工作区
 * 2. 回退：settings 中手动选择的目录（无工作区时）
 * @returns {{ dir: string, source: 'workspace'|'settings'|'' }}
 */
function resolveProjectDir() {
  const workspaceRoot = getActiveWorkspaceDir();
  if (workspaceRoot) {
    return {
      dir: resolveProjectInWorkspace(workspaceRoot),
      source: 'workspace'
    };
  }
  const configured = getConfiguredProjectDir();
  if (configured) {
    return { dir: configured, source: 'settings' };
  }
  return { dir: '', source: '' };
}

/** @returns {string} */
function getProjectDir() {
  return resolveProjectDir().dir;
}

/**
 * 无工程时提示用户选择。
 * @returns {Promise<string|null>} 选中的目录，取消则为 null
 */
async function ensureProjectDir() {
  const current = getProjectDir();
  if (current) return current;

  const pick = await vscode.window.showWarningMessage(
    '请选择工程：当前 VS Code 未打开工作区文件夹',
    { modal: false },
    '选择工程目录',
    '打开文件夹'
  );

  if (pick === '打开文件夹') {
    await vscode.commands.executeCommand('workbench.action.files.openFolder');
    return null;
  }
  if (pick !== '选择工程目录') return null;

  const dir = await pickProjectDir();
  if (!dir) return null;
  await setProjectDir(dir, true);
  return dir;
}

async function pickProjectDir() {
  const uris = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: '选择 STM32 工程目录',
    title: '请选择工程'
  });
  if (!uris || !uris[0]) return null;
  return uris[0].fsPath;
}

/**
 * 将 VS Code 工作区切换到指定工程目录（与 MCU 工具箱历史互通后的项目切换）。
 * @param {string} dir
 * @param {{ forceNewWindow?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, same?: boolean, error?: string }>}
 */
async function openProjectInVscode(dir, opts = {}) {
  const target = String(dir || '').trim();
  if (!target) return { ok: false, error: '目录为空' };
  if (!fs.existsSync(target)) return { ok: false, error: '目录不存在' };

  const folders = vscode.workspace.workspaceFolders || [];
  const same = folders.length === 1 && path.resolve(folders[0].uri.fsPath) === path.resolve(target);
  if (same && !opts.forceNewWindow) {
    return { ok: true, same: true };
  }

  try {
    await vscode.commands.executeCommand(
      'vscode.openFolder',
      vscode.Uri.file(target),
      { forceNewWindow: !!opts.forceNewWindow }
    );
    return { ok: true, same: false };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

function currentProjectInfo() {
  const { dir, source } = resolveProjectDir();
  const info = detectProject(dir, loadFlashConfig());
  info.source = source;
  return info;
}

module.exports = {
  detectProject,
  getActiveWorkspaceDir,
  resolveProjectInWorkspace,
  resolveProjectDir,
  getProjectDir,
  ensureProjectDir,
  pickProjectDir,
  openProjectInVscode,
  currentProjectInfo
};
