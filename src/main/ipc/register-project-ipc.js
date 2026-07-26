const { ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { loadConfig, addRecent, removeRecent } = require('../core/config');
const { findKeilProject, findIocFile, detectBuildSystem } = require('../flash/flasher');
const windows = require('../windows');

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
      fs.writeFileSync(result.filePath, JSON.stringify(data || [], null, 2), 'utf8');
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
      return { ok: true, data: JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8')) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

module.exports = { dirInfo, registerProjectIpc };
