import { ref, computed, watch } from 'vue';
import { baseName } from '../util.js';

// 烧录工具：工程识别 + 编译/烧录/一键 + 芯片探测 + 历史项目
// deps: { log:{appendLog,lastResult}, settings:{config}, appShell:{tool} }
export function useFlash(deps) {
  const { log, settings, appShell } = deps;
  const { appendLog, lastResult } = log;
  const config = settings.config;
  const tool = appShell.tool;

  const projectDir = ref('');
  const hasMakefile = ref(false);
  const hasKeil     = ref(false);
  const keilProject = ref('');
  const hasIoc      = ref(false);
  const iocFile     = ref('');
  const effBuildSystem = ref(null);
  const building   = ref(false);
  const flashing   = ref(false);
  const generating = ref(false);
  // 历史侧栏：默认展开；开启自动隐藏后，选项目/开始编译烧录会自动收起腾出日志区
  const historyOpen = ref(true);
  const historyAutoHide = ref(true);
  const recent      = ref([]);

  try {
    const savedOpen = localStorage.getItem('flash-history-open');
    if (savedOpen === '0' || savedOpen === '1') historyOpen.value = savedOpen === '1';
    const savedAuto = localStorage.getItem('flash-history-autohide');
    if (savedAuto === '0' || savedAuto === '1') historyAutoHide.value = savedAuto === '1';
  } catch {}

  function persistHistoryPrefs() {
    try {
      localStorage.setItem('flash-history-open', historyOpen.value ? '1' : '0');
      localStorage.setItem('flash-history-autohide', historyAutoHide.value ? '1' : '0');
    } catch {}
  }
  watch(historyOpen, persistHistoryPrefs);
  watch(historyAutoHide, persistHistoryPrefs);

  const busy = computed(() => building.value || flashing.value || generating.value);
  const projectValid = computed(() => hasMakefile.value || hasKeil.value);
  const canOperate = computed(() => projectDir.value && projectValid.value && !busy.value);
  const pathClass = computed(() => { if (!projectDir.value) return ''; return projectValid.value ? 'valid' : 'invalid'; });
  const buildSysLabel = computed(() => effBuildSystem.value === 'keil' ? 'Keil uVision5' : 'Makefile (GCC)');
  const flashLabel = computed(() => config.flashMethod === 'keil' ? 'Keil UV4' : (config.flashMethod === 'openocd' ? 'OpenOCD' : 'pyOCD'));
  const statusKind = computed(() => { if (busy.value) return 'busy'; return lastResult.value === 'ok' ? 'ok' : lastResult.value === 'err' ? 'err' : ''; });
  const statusText = computed(() => {
    if (generating.value) return '生成 Makefile…';
    if (building.value && flashing.value) return '编译烧录中…';
    if (building.value) return '编译中…';
    if (flashing.value) return '烧录中…';
    if (lastResult.value === 'ok') return '已完成';
    if (lastResult.value === 'err') return '失败';
    return '空闲';
  });

  function setHistoryOpen(open) {
    historyOpen.value = !!open;
  }
  function toggleHistory() {
    setHistoryOpen(!historyOpen.value);
  }
  function toggleHistoryAutoHide() {
    historyAutoHide.value = !historyAutoHide.value;
  }
  // 自动隐藏：仅在开启时收起，不强制展开（重新打开只靠右上角按钮）
  function maybeAutoHideHistory() {
    if (historyAutoHide.value && historyOpen.value) setHistoryOpen(false);
  }
  async function loadRecent() { try { recent.value = (await window.api.getRecent()) || []; } catch {} }
  function applyDirInfo(r) {
    hasMakefile.value = !!r.hasMakefile; hasKeil.value = !!r.hasKeil; keilProject.value = r.keilProject || '';
    hasIoc.value = !!r.hasIoc; iocFile.value = r.iocFile || ''; effBuildSystem.value = r.buildSystem || null;
  }
  async function openRecent(dir) {
    const r = await window.api.checkDir(dir); projectDir.value = dir; applyDirInfo(r);
    if (!r.exists) appendLog({ text: `[系统] ⚠ 目录不存在: ${dir}`, type: 'error' });
    else {
      appendLog({ text: `[系统] 已切换: ${dir}`, type: 'step' });
      if (!r.hasMakefile && !r.hasKeil && r.hasIoc) appendLog({ text: '[系统] 检测到 CubeMX 工程(.ioc) 但无 Makefile，点「一键生成 Makefile」即可', type: 'info' });
      else if (!r.hasMakefile && !r.hasKeil) appendLog({ text: '[系统] ⚠ 该目录下没有 Makefile 或 Keil 工程(.uvprojx)', type: 'error' });
    }
    await window.api.addRecent(dir); loadRecent();
    maybeAutoHideHistory();
  }
  async function delRecent(dir) { try { recent.value = (await window.api.removeRecent(dir)) || []; } catch {} }
  async function selectDir() {
    const result = await window.api.selectDirectory();
    if (result) {
      projectDir.value = result.dir; applyDirInfo(result);
      appendLog({ text: `[系统] 已选择: ${result.dir}`, type: 'step' });
      if (!result.hasMakefile && !result.hasKeil && result.hasIoc) appendLog({ text: '[系统] 检测到 CubeMX 工程(.ioc) 但无 Makefile，点「一键生成 Makefile」即可', type: 'info' });
      else if (!result.hasMakefile && !result.hasKeil) appendLog({ text: '[系统] ⚠ 该目录下没有 Makefile 或 Keil 工程(.uvprojx)', type: 'error' });
      loadRecent();
      maybeAutoHideHistory();
    }
  }

  async function doBuild() {
    building.value = true; lastResult.value = null; appendLog({ text: '═════════ 开始编译 ═════════', type: 'step' });
    maybeAutoHideHistory();
    try { const r = await window.api.build(projectDir.value); lastResult.value = r && r.success ? 'ok' : 'err'; }
    catch (e) { appendLog({ text: `[异常] ${e.message}`, type: 'error' }); lastResult.value = 'err'; }
    finally { building.value = false; }
  }
  async function doFlash() {
    flashing.value = true; lastResult.value = null; appendLog({ text: '═════════ 开始烧录 ═════════', type: 'step' });
    maybeAutoHideHistory();
    try { const r = await window.api.flash(projectDir.value); lastResult.value = r && r.success ? 'ok' : 'err'; }
    catch (e) { appendLog({ text: `[异常] ${e.message}`, type: 'error' }); lastResult.value = 'err'; }
    finally { flashing.value = false; }
  }
  async function doCheckProbe() {
    appendLog({ text: '═════════ 检测烧录器 ═════════', type: 'step' });
    try {
      const r = await window.api.checkProbe();
      appendLog({ text: `[烧录器] pyOCD: ${r.pyocd || '未配置'}`, type: r.ok ? 'info' : 'error' });
      if (!r.ok) { appendLog({ text: `[烧录器] ✗ ${r.error || '未检测到烧录器'}`, type: 'error' }); return; }
      appendLog({ text: `[烧录器] ✓ 检测到 ${r.probes.length} 个烧录器`, type: 'success' });
      r.probes.forEach((p, i) => appendLog({ text: `[烧录器] ${i}: ${p.name} UID=${p.uid}`, type: 'info' }));
    } catch (e) { appendLog({ text: `[异常] ${e.message}`, type: 'error' }); }
  }
  async function doReadChipInfo() {
    appendLog({ text: '═════════ 读取芯片信息 ═════════', type: 'step' });
    try {
      const r = await window.api.readChipInfo();
      if (!r.ok) { appendLog({ text: `[芯片] ✗ ${r.error || '读取失败'}`, type: 'error' }); return; }
      appendLog({ text: `[芯片] 烧录器: ${r.probe ? r.probe.name + ' UID=' + r.probe.uid : '未知'}`, type: 'info' });
      appendLog({ text: `[芯片] 目标: ${r.target}`, type: 'info' });
      if (r.detected) appendLog({ text: `[芯片] ✓ ${r.name} DEV_ID=${r.devid}`, type: 'success' });
      else appendLog({ text: `[芯片] 未读取到 DEV_ID，已使用配置目标: ${r.target}`, type: 'info' });
    } catch (e) { appendLog({ text: `[异常] ${e.message}`, type: 'error' }); }
  }
  async function doGenerateMakefile() {
    generating.value = true; lastResult.value = null; appendLog({ text: '═════════ 一键生成 Makefile (STM32CubeMX) ═════════', type: 'step' });
    maybeAutoHideHistory();
    try {
      const r = await window.api.generateMakefile(projectDir.value);
      if (r && r.ok) { const info = await window.api.checkDir(projectDir.value); applyDirInfo(info); lastResult.value = 'ok'; ElMessage.success('Makefile 已生成，可编译烧录了'); }
      else { lastResult.value = 'err'; ElMessage.error('生成失败，详见日志'); }
    } catch (e) { appendLog({ text: `[异常] ${e.message}`, type: 'error' }); lastResult.value = 'err'; }
    finally { generating.value = false; }
  }
  async function doBuildAndFlash() {
    building.value = true; flashing.value = true; lastResult.value = null; appendLog({ text: '═════════ 一键编译烧录 ═════════', type: 'step' });
    maybeAutoHideHistory();
    try {
      const r = await window.api.buildAndFlash(projectDir.value);
      if (!r.buildOk) { appendLog({ text: '[系统] 编译失败，跳过烧录', type: 'error' }); lastResult.value = 'err'; }
      else lastResult.value = r.flashOk ? 'ok' : 'err';
    } catch (e) { appendLog({ text: `[异常] ${e.message}`, type: 'error' }); lastResult.value = 'err'; }
    finally { building.value = false; flashing.value = false; }
  }

  return {
    projectDir, hasMakefile, hasKeil, keilProject, hasIoc, iocFile, building, flashing, generating, busy,
    canOperate, projectValid, pathClass, buildSysLabel, flashLabel, statusKind, statusText,
    selectDir, doBuild, doFlash, doBuildAndFlash, doCheckProbe, doReadChipInfo, doGenerateMakefile,
    historyOpen, historyAutoHide, recent, toggleHistory, toggleHistoryAutoHide,
    openRecent, delRecent,
    loadRecent, baseName
  };
}
