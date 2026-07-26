'use strict';

const vscode = require('vscode');
const { EventEmitter } = require('events');
const {
  jobLock,
  compile,
  flash,
  generateMakefile,
  checkProbeInfo,
  readChipInfo
} = require('../vendor/flash-core');
const {
  listRecentProjectInfos,
  addRecentProject,
  removeRecentProject
} = require('./recentStore');
const { checkReadiness } = require('./readiness');

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
  /** @type {any} */
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
      hasDesktopConfig: !!shared.hasDesktopConfig
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
        const readiness = await checkReadiness(cfg, dir);
        state.readiness = readiness;
        state.checking = false;
        emitState();
        return readiness;
      } catch (e) {
        state.readiness = {
          compiler: { ok: false, label: '编译器', detail: e.message || '检查失败' },
          flasher: { ok: false, online: false, label: '烧录设备', detail: e.message || '检查失败' },
          readyForBuild: false,
          readyForFlash: false,
          readyForBuildAndFlash: false,
          summary: e.message || '就绪检查失败'
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
      project,
      cfg,
      recent: listRecentProjectInfos(),
      busy: jobLock.isBusy(),
      job: (jobLock.getJobState().job && jobLock.getJobState().job.name) || state.job
    };
    emitState();
    // 异步刷新编译器/设备在线状态（不阻塞 UI）
    refreshReadiness(false).catch(() => {});
    return snapshot();
  }

  function touchRecent(dir) {
    if (!dir) return;
    try {
      addRecentProject(dir);
      state.recent = listRecentProjectInfos();
    } catch (e) {
      output.append(`[系统] 历史记录写入失败: ${e.message || e}`, 'warn');
    }
  }

  /**
   * 确保有工程目录；无则弹窗提示选择。
   * @returns {Promise<string|null>}
   */
  async function requireProjectDir() {
    let dir = getProjectDir();
    if (dir) return dir;

    output.append('[系统] 未打开工程，请选择工程目录', 'warn');
    if (typeof ensureProjectDir === 'function') {
      dir = await ensureProjectDir();
    }
    if (!dir) {
      output.append('[系统] ✗ 请选择工程', 'error');
      statusBar.setIdle('请选择工程');
      state.lastResult = 'err';
      await refreshState();
      return null;
    }
    await refreshState();
    return dir;
  }

  /**
   * 操作前检查编译器 / 烧录设备是否就绪
   * @param {'build'|'flash'|'build-and-flash'} kind
   */
  async function ensureReady(kind) {
    const readiness = await refreshReadiness(true);
    if (!readiness) return { ok: false, error: '就绪检查失败' };

    if (kind === 'build' || kind === 'build-and-flash') {
      if (!readiness.readyForBuild) {
        const detail = (readiness.compiler && readiness.compiler.detail) || '编译器未就绪';
        output.append(`[检查] ✗ 编译器未就绪：${detail}`, 'error');
        output.append('[检查] 请确认 make / arm-none-eabi-gcc（或 Keil UV4）已安装，并与当前编译方式匹配', 'info');
        statusBar.setResult(false);
        return { ok: false, error: detail, readiness };
      }
      output.append(`[检查] ✓ 编译器：${readiness.compiler.label} · ${readiness.compiler.detail}`, 'success');
    }

    if (kind === 'flash' || kind === 'build-and-flash') {
      if (!(readiness.flasher && readiness.flasher.ok)) {
        const detail = (readiness.flasher && readiness.flasher.detail) || '烧录工具未就绪';
        output.append(`[检查] ✗ 烧录工具未就绪：${detail}`, 'error');
        statusBar.setResult(false);
        return { ok: false, error: detail, readiness };
      }
      if (!readiness.readyForFlash) {
        const detail = (readiness.flasher && readiness.flasher.detail) || '烧录设备不在线';
        output.append(`[检查] ✗ 烧录设备不在线：${detail}`, 'error');
        output.append('[检查] 请插入 CMSIS-DAP/ST-Link 等调试器，确认 USB 数据线，并重新检测', 'info');
        statusBar.setResult(false);
        return { ok: false, error: detail, readiness };
      }
      output.append(`[检查] ✓ 烧录设备：${readiness.flasher.label} · ${readiness.flasher.detail}`, 'success');
    }

    return { ok: true, readiness };
  }

  /**
   * @param {string} name
   * @param {string} busyLabel
   * @param {(ctx: {dir: string, cfg: object}) => Promise<{ok: boolean, detail?: any}>} fn
   * @param {{ preflight?: 'build'|'flash'|'build-and-flash' }} [opts]
   */
  async function runJob(name, busyLabel, fn, opts = {}) {
    const dir = await requireProjectDir();
    const cfg = getConfig();
    if (!dir) {
      return { ok: false, error: '请选择工程' };
    }

    if (opts.preflight) {
      output.show(true);
      output.append('═════════ 就绪检查 ═════════', 'step');
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

    const locked = await jobLock.runExclusive(name, async () => fn({ dir, cfg }));
    if (locked.busy) {
      output.append(`[任务] 忙碌中：${locked.error}`, 'warn');
      statusBar.setBusy('忙碌');
      state.busy = true;
      emitState();
      return { ok: false, busy: true, error: locked.error };
    }

    const result = locked.result || { ok: false, error: locked.error || '任务失败' };
    state.busy = false;
    state.job = '';
    state.lastResult = result.ok ? 'ok' : 'err';
    statusBar.setResult(!!result.ok);
    await refreshState();
    return result;
  }

  /**
   * 选择/切换工程：写入历史（与 MCU 工具箱互通）+ 可选切换 VS Code 工作区
   * @param {string} dir
   * @param {{ openInVscode?: boolean }} [opts]
   */
  async function selectProject(dir, opts = {}) {
    if (!dir) return null;
    const openInVscode = opts.openInVscode !== false;
    await setProjectDir(dir);
    touchRecent(dir);
    output.append(`[系统] 已选择工程: ${dir}`, 'step');
    const info = detectProject(dir, getConfig());
    if (!info.exists) output.append(`[系统] ⚠ 目录不存在: ${dir}`, 'error');
    else if (!info.projectValid && info.hasIoc) {
      output.append('[系统] 检测到 CubeMX 工程(.ioc) 但无 Makefile，可执行「生成 Makefile」', 'info');
    } else if (!info.projectValid) {
      output.append('[系统] ⚠ 未检测到 Makefile 或 Keil 工程', 'error');
    }

    if (openInVscode && typeof openProjectInVscode === 'function' && info.exists) {
      const r = await openProjectInVscode(dir);
      if (r.ok && r.same) {
        output.append('[系统] 已是当前 VS Code 工作区', 'info');
      } else if (r.ok) {
        // openFolder 会重载窗口；后续日志可能看不到
        output.append('[系统] 正在切换 VS Code 到该工程…', 'step');
      } else {
        output.append(`[系统] 切换 VS Code 工作区失败: ${r.error || 'unknown'}`, 'warn');
      }
    }

    await refreshState();
    return info;
  }

  async function openRecent(dir) {
    return selectProject(dir, { openInVscode: true });
  }

  async function removeRecent(dir) {
    removeRecentProject(dir);
    output.append(`[系统] 已从历史移除: ${dir}`, 'info');
    await refreshState();
  }

  async function doBuild() {
    return runJob('build', '编译中…', async ({ dir, cfg }) => {
      touchRecent(dir);
      output.append('═════════ 开始编译 ═════════', 'step');
      output.append(`[系统] 工程: ${dir}`, 'info');
      const ok = await compile(dir, cfg);
      output.append(ok ? '[编译] 完成' : '[编译] 失败', ok ? 'success' : 'error');
      return { ok: !!ok };
    }, { preflight: 'build' });
  }

  async function doFlash() {
    return runJob('flash', '烧录中…', async ({ dir, cfg }) => {
      touchRecent(dir);
      output.append('═════════ 开始烧录 ═════════', 'step');
      output.append(`[系统] 工程: ${dir}`, 'info');
      const ok = await flash(dir, cfg);
      output.append(ok ? '[烧录] 完成' : '[烧录] 失败', ok ? 'success' : 'error');
      return { ok: !!ok };
    }, { preflight: 'flash' });
  }

  async function doBuildAndFlash() {
    return runJob('build-and-flash', '编译烧录中…', async ({ dir, cfg }) => {
      touchRecent(dir);
      output.append('═════════ 一键编译烧录 ═════════', 'step');
      output.append(`[系统] 工程: ${dir}`, 'info');
      const buildOk = await compile(dir, cfg);
      if (!buildOk) {
        output.append('[一键] 编译失败，跳过烧录', 'error');
        return { ok: false, buildOk: false, flashOk: false };
      }
      const flashOk = await flash(dir, cfg);
      output.append(
        flashOk ? '[一键] 编译烧录完成' : '[一键] 烧录失败',
        flashOk ? 'success' : 'error'
      );
      return { ok: !!flashOk, buildOk: true, flashOk: !!flashOk };
    }, { preflight: 'build-and-flash' });
  }

  async function doGenerateMakefile() {
    return runJob('generate-makefile', '生成 Makefile…', async ({ dir, cfg }) => {
      output.append('═════════ 生成 Makefile ═════════', 'step');
      const r = await generateMakefile(dir, cfg);
      const ok = !!(r && r.ok);
      output.append(ok ? '[生成] 完成' : `[生成] 失败: ${(r && r.error) || ''}`, ok ? 'success' : 'error');
      return { ok, detail: r };
    });
  }

  async function doCheckProbe() {
    output.show(true);
    output.append('═════════ 检测烧录器 / 就绪状态 ═════════', 'step');
    statusBar.setBusy('检测中…');
    try {
      const readiness = await refreshReadiness(true);
      const r = await checkProbeInfo(getConfig());
      if (readiness && readiness.compiler) {
        output.append(
          readiness.compiler.ok
            ? `[编译器] ✓ ${readiness.compiler.label} · ${readiness.compiler.detail}`
            : `[编译器] ✗ ${readiness.compiler.detail}`,
          readiness.compiler.ok ? 'success' : 'error'
        );
      }
      if (r && r.ok) {
        const n = (r.probes && r.probes.length) || 0;
        const name = (r.chosen && r.chosen.name) || (r.probes && r.probes[0] && r.probes[0].name) || '';
        output.append(`[烧录器] ✓ 在线 ${n} 个${name ? ' · ' + name : ''}`, 'success');
        statusBar.setResult(true);
      } else {
        output.append(`[烧录器] ✗ ${(r && r.error) || '未检测到烧录器'}`, 'error');
        statusBar.setResult(false);
      }
      await refreshState();
      return r;
    } catch (e) {
      output.append(`[异常] ${e.message}`, 'error');
      statusBar.setResult(false);
      return { ok: false, error: e.message };
    }
  }

  async function doReadChipInfo() {
    output.show(true);
    output.append('═════════ 读取芯片信息 ═════════', 'step');
    statusBar.setBusy('读芯片…');
    try {
      const r = await readChipInfo(getConfig());
      statusBar.setResult(!!(r && r.ok !== false));
      await refreshState();
      return r;
    } catch (e) {
      output.append(`[异常] ${e.message}`, 'error');
      statusBar.setResult(false);
      return { ok: false, error: e.message };
    }
  }

  function cancel() {
    const r = jobLock.cancelJob('user-cancel');
    if (r && r.ok) output.append('[任务] 已请求取消', 'warn');
    else output.append(`[任务] ${r && r.error ? r.error : '无法取消'}`, 'warn');
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
    doBuild,
    doFlash,
    doBuildAndFlash,
    doGenerateMakefile,
    doCheckProbe,
    doReadChipInfo,
    cancel
  };
}

module.exports = { createFlashService };
