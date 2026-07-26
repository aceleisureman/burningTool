const { ipcMain } = require('electron');
const { loadConfig, addRecent } = require('../core/config');
const jobLock = require('../core/job-lock');
const { generateMakefile, compile, flash } = require('../flash/flasher');
const { stc51ToolStatus, flashStc51 } = require('../flash/stc51');
const { esp32ToolStatus, flashEsp32 } = require('../flash/esp32');

function registerFlashIpc({ send }) {
  ipcMain.handle('job-status', () => jobLock.getJobState());
  ipcMain.handle('job-cancel', () => jobLock.cancelJob('user-cancel'));

  ipcMain.handle('stc51-tool-status', async () => stc51ToolStatus(loadConfig()));
  ipcMain.handle('flash-stc51', async (_e, opts) => {
    const locked = await jobLock.runExclusive('flash-stc51', async () => flashStc51(opts || {}, loadConfig()));
    if (locked.busy) return { ok: false, success: false, busy: true, error: locked.error };
    if (locked.ok === false && locked.result == null) return { ok: false, success: false, error: locked.error };
    return locked.result;
  });

  ipcMain.handle('esp32-tool-status', async () => esp32ToolStatus(loadConfig()));
  ipcMain.handle('flash-esp32', async (_e, opts) => {
    const locked = await jobLock.runExclusive('flash-esp32', async () => flashEsp32(opts || {}, loadConfig()));
    if (locked.busy) return { ok: false, success: false, busy: true, error: locked.error };
    if (locked.ok === false && locked.result == null) return { ok: false, success: false, error: locked.error };
    return locked.result;
  });

  ipcMain.handle('generate-makefile', async (_e, projectDir) => {
    addRecent(projectDir);
    const locked = await jobLock.runExclusive('generate-makefile', async () => {
      try {
        return await generateMakefile(projectDir, loadConfig());
      } catch (e) {
        send(`[生成] ✗ 异常: ${e.message}`, 'error');
        return { ok: false, error: e.message };
      }
    });
    if (locked.busy) {
      send(`[任务] 忙碌中，无法生成 Makefile：${locked.error}`, 'warn');
      return { ok: false, busy: true, error: locked.error };
    }
    return locked.result || { ok: false, error: locked.error || '生成失败' };
  });

  ipcMain.handle('build', async (_e, projectDir) => {
    addRecent(projectDir);
    const locked = await jobLock.runExclusive('build', async () => {
      const ok = await compile(projectDir, loadConfig());
      return { success: ok };
    });
    if (locked.busy) {
      send(`[任务] 忙碌中，无法开始编译：${locked.error}`, 'warn');
      return { success: false, busy: true, error: locked.error };
    }
    if (locked.ok === false && !locked.result) return { success: false, error: locked.error || '编译失败' };
    return locked.result || { success: false };
  });

  ipcMain.handle('flash', async (_e, projectDir) => {
    addRecent(projectDir);
    const locked = await jobLock.runExclusive('flash', async () => {
      const ok = await flash(projectDir, loadConfig());
      return { success: ok };
    });
    if (locked.busy) {
      send(`[任务] 忙碌中，无法开始烧录：${locked.error}`, 'warn');
      return { success: false, busy: true, error: locked.error };
    }
    if (locked.ok === false && !locked.result) return { success: false, error: locked.error || '烧录失败' };
    return locked.result || { success: false };
  });

  ipcMain.handle('build-and-flash', async (_e, projectDir) => {
    addRecent(projectDir);
    const locked = await jobLock.runExclusive('build-and-flash', async () => {
      const cfg = loadConfig();
      const buildOk = await compile(projectDir, cfg);
      if (!buildOk) return { buildOk: false, flashOk: false };
      const flashOk = await flash(projectDir, cfg);
      return { buildOk, flashOk };
    });
    if (locked.busy) {
      send(`[任务] 忙碌中，无法一键编译烧录：${locked.error}`, 'warn');
      return { buildOk: false, flashOk: false, busy: true, error: locked.error };
    }
    if (locked.ok === false && !locked.result) {
      return { buildOk: false, flashOk: false, error: locked.error || '任务失败' };
    }
    return locked.result || { buildOk: false, flashOk: false };
  });
}

module.exports = { registerFlashIpc };
