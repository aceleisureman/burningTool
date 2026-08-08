'use strict';

const vscode = require('vscode');
const { EventEmitter } = require('events');
const { jobLock, checkProbeInfo, readChipInfo } = require('../vendor/flash-core');
const {
  listRecentProjectInfos,
  addRecentProject,
  removeRecentProject
} = require('./recentStore');
const { getPlatform } = require('./platforms/index');
const { t, locale } = require('./i18n');

/**
 * @param {object} deps
 */
function createFlashService(deps) {
  const {
    output,
    statusBar,
    getConfig,
    getProjectDir,
    setProjectDir,
    detectProject,
    ensureProjectDir,
    resolveProjectDir,
    openProjectInVscode
  } = deps;

  const emitter = new EventEmitter();
  let state = {
    busy: false,
    job: '',
    lastResult: null,
    project: buildProjectState(),
    cfg: getConfig(),
    recent: listRecentProjectInfos(),
    readiness: null,
    checking: false
  };

  /** @type {Promise<any>|null} */
  let readinessTask = null;

  function buildProjectState() {
    const resolved = resolveProjectDir ? resolveProjectDir() : { dir: getProjectDir(), source: '' };
    const info = detectProject(resolved.dir, getConfig());
    info.source = resolved.source || '';
    return info;
  }

  function snapshot() {
    const cfg = state.cfg || {};
    const shared = cfg._shared || {};
    return {
      ...state,
      project: { ...state.project },
      cfg: { ...cfg },
      recent: (state.recent || []).map((r) => ({ ...r })),
      readiness: state.readiness ? JSON.parse(JSON.stringify(state.readiness)) : null,
      isWindows: process.platform === 'win32',
      platformId: shared.platformId || (process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'),
      hasWorkspace: !!(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length),
      toolchainRoot: shared.toolchainRoot || cfg.toolchainRootPath || '',
      hasToolchain: !!shared.hasToolchain,
      hasDesktopConfig: !!shared.hasDesktopConfig,
      locale: locale(),
      // PlatformIO IDE 扩展是否已安装
      hasPioExtension: !!(vscode.extensions.getExtension('platformio.platformio-ide'))
    };
  }

  function emitState() {
    emitter.emit('state', snapshot());
  }

  async function refreshReadiness(force) {
    if (readinessTask && !force) return readinessTask;
    state.checking = true;
    emitState();
    readinessTask = (async () => {
      try {
        const cfg = getConfig();
        const dir = getProjectDir();
        const platform = getPlatform(cfg.projectMode || 'stm32cube');
        const readiness = await platform.checkReadiness(cfg, dir);
        state.readiness = readiness;
        state.checking = false;
        emitState();
        return readiness;
      } catch (e) {
        state.readiness = {
          compiler: { ok: false, label: t('readiness.compiler'), detail: e.message || t('check.fail') },
          flasher:  { ok: false, online: false, label: t('readiness.device'), detail: e.message || t('check.fail') },
          readyForBuild: false, readyForFlash: false, readyForBuildAndFlash: false,
          summary: e.message || t('check.fail')
        };
        state.checking = false;
        emitState();
        return state.readiness;
      } finally {
        readinessTask = null;
      }
    })();
    return readinessTask;
  }

  async function refreshState() {
    const cfg = getConfig();
    const project = buildProjectState();
    state = {
      ...state,
      project, cfg,
      recent: listRecentProjectInfos(),
      busy: jobLock.isBusy(),
      job: (jobLock.getJobState().job && jobLock.getJobState().job.name) || state.job
    };
    emitState();
    refreshReadiness(false).catch(() => {});
    return snapshot();
  }

  function touchRecent(dir) {
    if (!dir) return;
    try {
      addRecentProject(dir);
      state.recent = listRecentProjectInfos();
    } catch (e) {
      output.append(t('sys.recent_write_fail', e.message || e), 'warn');
    }
  }

  async function requireProjectDir() {
    let dir = getProjectDir();
    if (dir) return dir;
    output.append(t('sys.no_project_warn'), 'warn');
    if (typeof ensureProjectDir === 'function') dir = await ensureProjectDir();
    if (!dir) {
      output.append(t('sys.no_project_err'), 'error');
      statusBar.setIdle(t('status.select'));
      state.lastResult = 'err';
      await refreshState();
      return null;
    }
    await refreshState();
    return dir;
  }

  /**
   * 操作前检查就绪（使用平台处理器）
   * @param {'build'|'flash'|'build-and-flash'} kind
   */
  async function ensureReady(kind) {
    const readiness = await refreshReadiness(true);
    if (!readiness) return { ok: false, error: t('check.fail') };

    if (kind === 'build' || kind === 'build-and-flash') {
      if (!readiness.readyForBuild) {
        const detail = (readiness.compiler && readiness.compiler.detail) || t('check.compiler_not_ready');
        output.append(t('check.compiler_fail', detail), 'error');
        output.append(t('check.compiler_hint'), 'info');
        statusBar.setResult(false);
        return { ok: false, error: detail, readiness };
      }
      output.append(t('check.compiler_ok', readiness.compiler.label, readiness.compiler.detail), 'success');
    }

    if (kind === 'flash' || kind === 'build-and-flash') {
      if (!(readiness.flasher && readiness.flasher.ok)) {
        const detail = (readiness.flasher && readiness.flasher.detail) || t('check.flasher_not_ready');
        output.append(t('check.flasher_fail', detail), 'error');
        statusBar.setResult(false);
        return { ok: false, error: detail, readiness };
      }
      if (!readiness.readyForFlash) {
        const detail = (readiness.flasher && readiness.flasher.detail) || t('check.device_not_online');
        output.append(t('check.device_offline', detail), 'error');
        output.append(t('check.device_hint'), 'info');
        statusBar.setResult(false);
        return { ok: false, error: detail, readiness };
      }
      output.append(t('check.device_ok', readiness.flasher.label, readiness.flasher.detail), 'success');
    }

    return { ok: true, readiness };
  }

  /**
   * 通用任务框架 — 所有平台共用，消除 ESP32 重复代码
   * @param {string} name
   * @param {string} busyLabel
   * @param {(ctx) => Promise<{ok, error?, buildOk?, flashOk?}>} fn
   * @param {{ preflight?: 'build'|'flash'|'build-and-flash', skipProjectCheck?: boolean }} opts
   */
  async function runJob(name, busyLabel, fn, opts = {}) {
    const cfg = getConfig();
    const platform = getPlatform(cfg.projectMode || 'stm32cube');

    // ESP32 模式不强制要求 projectValid（pio 本身管理工程）
    const skipProjectCheck = opts.skipProjectCheck || platform.id === 'esp32';
    const dir = skipProjectCheck ? (getProjectDir() || '') : await requireProjectDir();

    if (!skipProjectCheck && !dir) {
      return { ok: false, error: t('status.select') };
    }

    if (opts.preflight) {
      output.show(true);
      output.append(t('check.section'), 'step');
      const gate = await ensureReady(opts.preflight);
      if (!gate.ok) {
        state.lastResult = 'err';
        emitState();
        return { ok: false, error: gate.error };
      }
    }

    output.show(true);
    statusBar.setBusy(busyLabel);
    state.busy = true;
    state.job = name;
    state.lastResult = null;
    emitState();

    const locked = await jobLock.runExclusive(name, async () => fn({ dir, cfg, output, statusBar, t, platform }));
    if (locked.busy) {
      output.append(t('task.busy', locked.error), 'warn');
      statusBar.setBusy(t('status.busy'));
      state.busy = true;
      emitState();
      return { ok: false, busy: true, error: locked.error };
    }

    const result = locked.result || { ok: false, error: locked.error || t('task.fail') };
    state.busy = false;
    state.job = '';
    state.lastResult = result.ok ? 'ok' : 'err';
    statusBar.setResult(!!result.ok);
    await refreshState();
    return result;
  }

  async function selectProject(dir, opts = {}) {
    if (!dir) return null;
    const openInVscode = opts.openInVscode !== false;
    await setProjectDir(dir);
    touchRecent(dir);
    output.append(t('sys.project_selected', dir), 'step');
    const info = detectProject(dir, getConfig());
    if (!info.exists) output.append(t('sys.no_dir', dir), 'error');
    else if (!info.projectValid && info.hasIoc) output.append(t('sys.has_ioc'), 'info');
    else if (!info.projectValid) output.append(t('sys.no_makefile'), 'error');

    if (openInVscode && typeof openProjectInVscode === 'function' && info.exists) {
      const r = await openProjectInVscode(dir);
      if (r.ok && r.same)        output.append(t('sys.vscode_same'), 'info');
      else if (r.ok)             output.append(t('sys.vscode_switching'), 'step');
      else output.append(t('sys.vscode_switch_fail', r.error || 'unknown'), 'warn');
    }

    await refreshState();
    return info;
  }

  async function openRecent(dir) { return selectProject(dir, { openInVscode: true }); }

  async function removeRecent(dir) {
    removeRecentProject(dir);
    output.append(t('sys.recent_removed', dir), 'info');
    await refreshState();
  }

  // ── 核心操作：通过平台处理器执行，无 if/else ──────────────────────────────

  async function doBuild() {
    return runJob('build', t('status.building'), async (ctx) => {
      touchRecent(ctx.dir);
      return ctx.platform.build(ctx);
    }, { preflight: 'build', skipProjectCheck: false });
  }

  async function doFlash() {
    return runJob('flash', t('status.flashing'), async (ctx) => {
      touchRecent(ctx.dir);
      return ctx.platform.flash(ctx);
    }, { preflight: 'flash' });
  }

  async function doBuildAndFlash() {
    return runJob('build-and-flash', t('status.building_flashing'), async (ctx) => {
      touchRecent(ctx.dir);
      return ctx.platform.buildAndFlash(ctx);
    }, { preflight: 'build-and-flash' });
  }

  async function doGenerateMakefile() {
    return runJob('generate-makefile', t('status.generating'), async ({ dir, cfg: c }) => {
      const { generateMakefile } = require('../vendor/flash-core');
      output.append(t('makefile.section'), 'step');
      const r = await generateMakefile(dir, c);
      const ok = !!(r && r.ok);
      output.append(ok ? t('makefile.done') : t('makefile.fail', (r && r.error) || ''), ok ? 'success' : 'error');
      return { ok, detail: r };
    });
  }

  async function doCheckProbe() {
    output.show(true);
    output.append(t('probe.section'), 'step');
    statusBar.setBusy(t('status.checking'));
    try {
      const cfg = getConfig();
      const platform = getPlatform(cfg.projectMode || 'stm32cube');
      const readiness = await refreshReadiness(true);
      if (readiness && readiness.compiler) {
        output.append(
          readiness.compiler.ok
            ? t('probe.compiler_ok', readiness.compiler.label, readiness.compiler.detail)
            : t('probe.compiler_fail', readiness.compiler.detail),
          readiness.compiler.ok ? 'success' : 'error'
        );
      }
      // 平台支持 checkProbe 时执行
      const r = platform.checkProbe ? await platform.checkProbe(cfg) : null;
      if (r) {
        if (r.ok) {
          const n = (r.probes && r.probes.length) || 0;
          const name = (r.chosen && r.chosen.name) || (r.probes && r.probes[0] && r.probes[0].name) || '';
          output.append(t('probe.online', n, name ? ' · ' + name : ''), 'success');
          statusBar.setResult(true);
        } else {
          output.append(t('probe.fail', (r && r.error) || t('probe.none')), 'error');
          statusBar.setResult(false);
        }
      } else {
        output.append('[检测] 当前模式不支持探针检测', 'info');
        statusBar.setResult(true);
      }
      await refreshState();
      return r;
    } catch (e) {
      output.append(t('err.exception', e.message), 'error');
      statusBar.setResult(false);
      return { ok: false, error: e.message };
    }
  }

  async function doReadChipInfo() {
    output.show(true);
    output.append(t('chip.section'), 'step');
    statusBar.setBusy(t('status.reading_chip'));
    try {
      const cfg = getConfig();
      const platform = getPlatform(cfg.projectMode || 'stm32cube');
      const r = platform.readChipInfo ? await platform.readChipInfo(cfg) : null;
      if (!r) output.append('[芯片] 当前模式不支持芯片信息读取', 'info');
      statusBar.setResult(!!(r && r.ok !== false));
      await refreshState();
      return r;
    } catch (e) {
      output.append(t('err.exception', e.message), 'error');
      statusBar.setResult(false);
      return { ok: false, error: e.message };
    }
  }

  function cancel() {
    const r = jobLock.cancelJob('user-cancel');
    if (r && r.ok) output.append(t('task.cancel_ok'), 'warn');
    else output.append(t('task.cancel_none', (r && r.error) ? r.error : t('task.cancel_fail')), 'warn');
    return r;
  }

  return {
    on: (ev, fn) => emitter.on(ev, fn),
    off: (ev, fn) => emitter.off(ev, fn),
    getState: snapshot,
    refreshState,
    refreshReadiness,
    requireProjectDir,
    selectProject,
    openRecent,
    removeRecent,
    doBuild, doFlash, doBuildAndFlash,
    doGenerateMakefile,
    doCheckProbe,
    doReadChipInfo,
    cancel
  };
}

module.exports = { createFlashService };
