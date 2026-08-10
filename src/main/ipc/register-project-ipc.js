const { ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { loadConfig, addRecent, removeRecent } = require('../core/config');
const { findKeilProject, findIocFile, detectBuildSystem } = require('../flash/flasher');
const windows = require('../windows');

const MAX_QUICKCMD_FILE_BYTES = 2 * 1024 * 1024;
const MAX_QUICKCMD_GROUPS = 128;
const MAX_QUICKCMD_COUNT = 4096;
const MAX_QUICKCMD_TEXT_CHARS = 64 * 1024;

function validateQuickCmdData(data) {
  let groups = null;
  if (data && data.schema === 'mcu-toolbox.serial-commands' && data.version === 1 && Array.isArray(data.groups)) groups = data.groups;
  else if (Array.isArray(data) && data.some((item) => item && Array.isArray(item.cmds))) groups = data;
  else if (data && Array.isArray(data.serialCmdGroups)) groups = data.serialCmdGroups;
  else if (Array.isArray(data)) groups = [{ cmds: data }];
  else if (data && Array.isArray(data.serialQuickCmds)) groups = [{ cmds: data.serialQuickCmds }];
  if (!groups) return { ok: true };
  if (groups.length > MAX_QUICKCMD_GROUPS) return { ok: false, error: `分组数量不能超过 ${MAX_QUICKCMD_GROUPS}` };
  let count = 0;
  for (const group of groups) {
    if (!group || !Array.isArray(group.cmds)) continue;
    count += group.cmds.length;
    if (count > MAX_QUICKCMD_COUNT) return { ok: false, error: `快捷指令数量不能超过 ${MAX_QUICKCMD_COUNT}` };
    for (const cmd of group.cmds) {
      if (!cmd || typeof cmd !== 'object') continue;
      for (const key of ['name', 'content']) {
        if (cmd[key] != null && String(cmd[key]).length > MAX_QUICKCMD_TEXT_CHARS) {
          return { ok: false, error: `快捷指令${key === 'name' ? '名称' : '内容'}过长` };
        }
      }
    }
  }
  return { ok: true };
}

function dirInfo(dir) {
  const exists = !!dir && fs.existsSync(dir);
  const hasMakefile = exists && fs.existsSync(path.join(dir, 'Makefile'));
  const keilProj = exists ? findKeilProject(dir) : null;
  const iocFile = exists ? findIocFile(dir) : null;
  return {
    dir,
    exists,
    hasMakefile,
    hasKeil: !!keilProj,
    keilProject: keilProj ? (path.relative(dir, keilProj) || path.basename(keilProj)) : '',
    hasIoc: !!iocFile,
    iocFile: iocFile ? (path.relative(dir, iocFile) || path.basename(iocFile)) : '',
    buildSystem: exists ? detectBuildSystem(dir, loadConfig(), keilProj) : null
  };
}

function registerProjectIpc() {
  ipcMain.handle('get-recent', () => loadConfig().recentProjects || []);
  ipcMain.handle('add-recent', (_e, dir) => addRecent(dir));
  ipcMain.handle('remove-recent', (_e, dir) => removeRecent(dir));
  ipcMain.handle('check-dir', (_e, dir) => dirInfo(dir));

  ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog(windows.getMainWindow(), { properties: ['openDirectory'] });
    if (result.canceled) return null;
    const dir = result.filePaths[0];
    const info = dirInfo(dir);
    if (info.hasMakefile || info.hasKeil || info.hasIoc) addRecent(dir);
    return info;
  });

  ipcMain.handle('select-firmware-file', async () => {
    const result = await dialog.showOpenDialog(windows.getMainWindow(), {
      title: '选择固件文件',
      properties: ['openFile'],
      filters: [
        { name: '固件文件', extensions: ['hex', 'ihx', 'bin', 'elf', 'axf'] },
        { name: '51 / STC 固件', extensions: ['hex', 'ihx', 'bin'] },
        { name: '全部文件', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return null;
    const file = result.filePaths[0];
    try {
      const stat = fs.statSync(file);
      return { path: file, name: path.basename(file), size: stat.size, ext: path.extname(file).toLowerCase() };
    } catch (e) {
      return { path: file, name: path.basename(file), size: 0, ext: path.extname(file).toLowerCase(), error: e.message };
    }
  });

  ipcMain.handle('export-quickcmds', async (_e, data) => {
    const result = await dialog.showSaveDialog(windows.getMainWindow(), {
      title: '导出快捷指令',
      defaultPath: 'quick-commands.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      const valid = validateQuickCmdData(data);
      if (!valid.ok) return valid;
      const text = JSON.stringify(data || [], null, 2);
      if (Buffer.byteLength(text, 'utf8') > MAX_QUICKCMD_FILE_BYTES) return { ok: false, error: `导出文件不能超过 ${MAX_QUICKCMD_FILE_BYTES} 字节` };
      fs.writeFileSync(result.filePath, text, 'utf8');
      return { ok: true, path: result.filePath };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('import-quickcmds', async () => {
    const result = await dialog.showOpenDialog(windows.getMainWindow(), {
      title: '导入快捷指令',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, canceled: true };
    try {
      const stat = fs.statSync(result.filePaths[0]);
      if (!stat.isFile()) return { ok: false, error: '选择的路径不是文件' };
      if (stat.size > MAX_QUICKCMD_FILE_BYTES) return { ok: false, error: `导入文件不能超过 ${MAX_QUICKCMD_FILE_BYTES} 字节` };
      const data = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
      const valid = validateQuickCmdData(data);
      return valid.ok ? { ok: true, data } : valid;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

module.exports = { dirInfo, registerProjectIpc };
