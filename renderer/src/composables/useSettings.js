import { ref, reactive, computed, onMounted } from 'vue';

// 配置 / 平台 / 工具链：读取&保存配置、平台识别、编译环境与默认工具链安装
// deps: { appendLog, appShell:{tool,prevTool}, serial, mqtt }
export function useSettings(deps) {
  const { appendLog, appShell, serial, mqtt } = deps;

  const platform = ref('unknown');
  const toolchainProfile = reactive({ label: '', supportsKeil: false, commandTools: { mode: 'system' }, defaultDownloads: { gcc: {}, make: {} }, placeholders: {} });
  const config = reactive({ targetChip: 'stm32f103c8', elfName: '', flashMethod: 'pyocd' });
  const draft  = reactive({ armGccPath: '', makePath: '', pyocdPath: '', openocdPath: '', targetChip: '', elfName: '', autoDetectChip: true, connectUnderReset: false, toolchainMode: 'custom', toolchainRootPath: '', ghProxy: '', buildSystem: 'auto', keilUV4Path: '', keilRebuild: false, cubeMxPath: '', flashMethod: 'pyocd' });
  const settingsVisible = ref(false);
  const envReady   = ref(false);
  const installing = ref(false);
  const installingDefault = ref(false);
  const defaultTc   = reactive({ gccBin: '', makeBin: '', busybox: false, pyocdBin: '', openocdBin: '', root: '', toolchainRootPath: '' });
  const toolProgress = reactive({
    gcc: { percent: 0, active: false, status: 'idle', note: '' },
    make: { percent: 0, active: false, status: 'idle', note: '' },
    openocd: { percent: 0, active: false, status: 'idle', note: '' },
    pyocd: { percent: 0, active: false, status: 'idle', note: '' },
    commandTools: { percent: 0, active: false, status: 'idle', note: '' }
  });
  const pathEnv = reactive({ supported: true, present: false, partial: false, dirs: [], matched: [], missing: [], message: '', label: '系统 PATH', profile: '', scope: '' });
  const pathEnvBusy = ref(false);
  const dlProgress  = reactive({ active: false, label: '', percent: 0 });
  const toolDetail = reactive({ visible: false, title: '', rows: [], commands: [] });

  function browserPlatformInfo() {
    const p = String((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || '').toLowerCase();
    if (p.includes('win')) return { id: 'windows', platform: 'win32', label: 'Windows', arch: 'x64', gccFile: 'xpack-arm-none-eabi-gcc-14.2.1-1.1-win32-x64.zip', makeMode: 'download', supportsKeil: true };
    if (p.includes('mac')) return { id: 'macos', platform: 'darwin', label: 'macOS', arch: 'arm64/x64', gccFile: 'xpack-arm-none-eabi-gcc-14.2.1-1.1-darwin-arm64.tar.gz', makeMode: 'system', supportsKeil: false };
    return { id: 'linux', platform: 'linux', label: 'Linux', arch: 'x64/arm64', gccFile: 'xpack-arm-none-eabi-gcc-14.2.1-1.1-linux-x64.tar.gz', makeMode: 'system', supportsKeil: false };
  }
  function applyBrowserPlatformFallback() {
    const fb = browserPlatformInfo();
    if (!platform.value || platform.value === 'unknown') platform.value = fb.platform;
    if (!toolchainProfile.id) toolchainProfile.id = fb.id;
    if (!toolchainProfile.label) toolchainProfile.label = fb.label;
    if (toolchainProfile.supportsKeil == null) toolchainProfile.supportsKeil = fb.supportsKeil;
    toolchainProfile.systemInfo = Object.assign({ platform: fb.platform, arch: fb.arch, displayVersion: '' }, toolchainProfile.systemInfo || {});
    toolchainProfile.defaultDownloads = Object.assign({ gcc: {}, make: {} }, toolchainProfile.defaultDownloads || {});
    toolchainProfile.defaultDownloads.gcc = Object.assign({ mode: 'download', fileName: fb.gccFile }, toolchainProfile.defaultDownloads.gcc || {});
    toolchainProfile.defaultDownloads.make = Object.assign({ mode: fb.makeMode }, toolchainProfile.defaultDownloads.make || {});
    toolchainProfile.commandTools = Object.assign({ mode: fb.id === 'windows' ? 'busybox' : 'system' }, toolchainProfile.commandTools || {});
    toolchainProfile.placeholders = Object.assign({}, toolchainProfile.placeholders || {});
  }
  applyBrowserPlatformFallback();

  const isWindows = computed(() => platform.value === 'win32');
  const isLinux = computed(() => platform.value === 'linux');
  const systemInfo = computed(() => toolchainProfile.systemInfo || {});
  const systemDisplayName = computed(() => {
    const info = systemInfo.value;
    const label = toolchainProfile.label || platform.value || '未知系统';
    const version = info.displayVersion || info.release || '';
    return version ? `${label} ${version}` : label;
  });
  const systemRuntimeLabel = computed(() => {
    const info = systemInfo.value;
    return `${info.platform || platform.value || 'unknown'} / ${info.arch || 'unknown'}`;
  });
  const systemDownloadLabel = computed(() => {
    const gcc = toolchainProfile.defaultDownloads && toolchainProfile.defaultDownloads.gcc;
    return gcc && gcc.fileName ? `下载包：${gcc.fileName}` : '当前系统无默认下载包';
  });
  const envButtonText = computed(() => (toolchainProfile.commandTools && toolchainProfile.commandTools.mode === 'busybox') ? '安装编译环境' : '检查系统编译环境');
  const envButtonReadyText = computed(() => (toolchainProfile.commandTools && toolchainProfile.commandTools.mode === 'busybox') ? '编译环境已就绪' : '系统编译环境可用');
  const defaultInstallButtonText = computed(() => {
    if (draft.toolchainMode !== 'default') return '检查自定义路径';
    const makeMode = toolchainProfile.defaultDownloads && toolchainProfile.defaultDownloads.make && toolchainProfile.defaultDownloads.make.mode;
    return makeMode === 'download' ? '下载缺失的工具链' : '下载 ARM GCC';
  });
  const defaultToolchainRootDisplay = computed(() => {
    const custom = String(draft.toolchainRootPath || defaultTc.toolchainRootPath || '').trim();
    if (custom) return custom;
    if (defaultTc.root) return defaultTc.root;
    return '应用数据目录 toolchain/（升级后保留）';
  });
  const defaultToolchainHint = computed(() => {
    const label = toolchainProfile.label || '当前平台';
    if (draft.toolchainMode !== 'default') return `${label} 当前使用自定义路径，不会自动下载工具链。`;
    const makeMode = toolchainProfile.defaultDownloads && toolchainProfile.defaultDownloads.make && toolchainProfile.defaultDownloads.make.mode;
    const rootText = defaultToolchainRootDisplay.value;
    if (makeMode === 'download') return `下载到 ${rootText}（ARM GCC + make + OpenOCD + 编译命令），创建本地 pyOCD，。`;
    return `${label} 默认下载到 ${rootText}：ARM GCC、OpenOCD、本地 pyOCD；。make 与 rm/mkdir/sh 等命令使用系统自带环境。`;
  });

  async function setFlashMethod(v) { config.flashMethod = v; try { Object.assign(config, await window.api.saveConfig({ flashMethod: v })); } catch (_e) {} }
  async function setAutoDetect(v) { config.autoDetectChip = v; try { Object.assign(config, await window.api.saveConfig({ autoDetectChip: v })); } catch (_e) {} }
  const flashMethodModel = computed({ get: () => config.flashMethod || 'pyocd', set: (v) => setFlashMethod(v) });
  const autoDetectModel  = computed({ get: () => config.autoDetectChip !== false, set: (v) => setAutoDetect(v) });
  async function setUnderReset(v) { config.connectUnderReset = v; try { Object.assign(config, await window.api.saveConfig({ connectUnderReset: v })); } catch (_e) {} }
  const underResetModel  = computed({ get: () => config.connectUnderReset === true, set: (v) => setUnderReset(v) });

  async function loadConfig() {
    applyBrowserPlatformFallback();
    try { platform.value = await window.api.getPlatform(); } catch (_e) { applyBrowserPlatformFallback(); }
    try { Object.assign(toolchainProfile, await window.api.getPlatformToolchain()); } catch (_e) { applyBrowserPlatformFallback(); }
    applyBrowserPlatformFallback();
    const cfg = await window.api.getConfig(); Object.assign(config, cfg);
    if (!isWindows.value) {
      if (config.flashMethod === 'keil') config.flashMethod = 'pyocd';
    }
    serial.initFromConfig(cfg);
    mqtt.initFromConfig(cfg);
  }
  async function openSettings() {
    const cfg = await window.api.getConfig();
    Object.assign(draft, cfg);
    if (!isWindows.value) {
      if (draft.buildSystem === 'keil') draft.buildSystem = 'make';
      if (draft.flashMethod === 'keil') draft.flashMethod = 'pyocd';
    }
    refreshDefaultTc();
    if (appShell.tool.value !== 'settings') appShell.prevTool.value = appShell.tool.value;
    appShell.tool.value = 'settings';
  }
  function closeSettings() { appShell.tool.value = (appShell.prevTool.value && appShell.prevTool.value !== 'settings') ? appShell.prevTool.value : 'flash'; }

  async function chooseToolchainRoot() {
    try {
      const result = await window.api.selectDirectory();
      // selectDirectory 返回 dirInfo: { dir, hasMakefile, ... }，取消时为 null
      if (result && result.dir) {
        draft.toolchainRootPath = result.dir;
      }
    } catch (e) { ElMessage.error('选择目录失败：' + (e && e.message ? e.message : e)); }
  }
  function clearToolchainRoot() { draft.toolchainRootPath = ''; }
  async function saveSettings() {
    try {
      const plain = JSON.parse(JSON.stringify(draft));
      const platformId = toolchainProfile.id || (isWindows.value ? 'windows' : (isLinux.value ? 'linux' : 'macos'));
      plain.platformPaths = Object.assign({}, plain.platformPaths || {});
      plain.platformPaths[platformId] = Object.assign({}, plain.platformPaths[platformId] || {}, {
        armGccPath: plain.armGccPath,
        makePath: plain.makePath,
        pyocdPath: plain.pyocdPath,
        openocdPath: plain.openocdPath,
        cubeMxPath: plain.cubeMxPath,
        keilUV4Path: plain.keilUV4Path
      });
      if (!isWindows.value) {
        if (plain.buildSystem === 'keil') plain.buildSystem = 'make';
        if (plain.flashMethod === 'keil') plain.flashMethod = 'pyocd';
      }
      const saved = await window.api.saveConfig(plain);
      Object.assign(config, saved); closeSettings(); ElMessage.success('设置已保存');
    } catch (e) { appendLog({ text: `[异常] 保存设置失败: ${e.message}`, type: 'error' }); ElMessage.error('保存失败：' + e.message); }
  }
  async function resetSettings() { const saved = await window.api.resetConfig(); Object.assign(draft, saved); Object.assign(config, saved); ElMessage.info('已恢复默认设置'); }

  async function checkEnv() { try { const s = await window.api.toolchainStatus(); envReady.value = !!s.installed; } catch {} }
  async function installEnv() {
    installing.value = true; appendLog({ text: '═════════ 安装编译环境 ═════════', type: 'step' });
    try { const r = await window.api.installToolchain(); envReady.value = !!r.installed; if (r.installed) ElMessage.success('编译环境已就绪'); else ElMessage.error('安装失败，详见日志'); }
    catch (e) { appendLog({ text: `[异常] ${e.message}`, type: 'error' }); }
    installing.value = false;
  }

  function mapProgressLabel(label) {
    const t = String(label || '').toLowerCase();
    if (!t) return '';
    if (t.includes('gcc') || t.includes('arm')) return 'gcc';
    if (t.includes('make')) return 'make';
    if (t.includes('openocd')) return 'openocd';
    if (t.includes('pyocd')) return 'pyocd';
    if (t.includes('busybox') || t.includes('command') || t.includes('编译命令')) return 'commandTools';
    return '';
  }
  function resetToolProgress() {
    for (const k of Object.keys(toolProgress)) {
      toolProgress[k].percent = 0;
      toolProgress[k].active = false;
      toolProgress[k].status = 'idle';
      toolProgress[k].note = '';
    }
  }
  function markToolProgress(key, patch) {
    if (!key || !toolProgress[key]) return;
    Object.assign(toolProgress[key], patch || {});
  }
  function toolProgressText(key) {
    const p = toolProgress[key];
    if (!p) return '';
    if (p.status === 'downloading') return `下载中 ${Math.max(0, Math.min(100, p.percent | 0))}%`;
    if (p.status === 'installing') return p.note || '安装中…';
    if (p.status === 'done') return '完成';
    if (p.status === 'error') return '失败';
    if (p.status === 'skip') return '已存在';
    return '';
  }
  function toolReady(key) {
    if (key === 'gcc') return !!defaultTc.gccBin;
    if (key === 'make') return !!defaultTc.makeBin;
    if (key === 'pyocd') return !!defaultTc.pyocdBin;
    if (key === 'openocd') return !!defaultTc.openocdBin;
    if (key === 'commandTools') return !!(defaultTc.busybox || (toolchainProfile.commandTools && toolchainProfile.commandTools.mode === 'system'));
    return false;
  }
  function toolName(key) {
    if (key === 'gcc') return 'ARM GCC';
    if (key === 'make') return 'make';
    if (key === 'pyocd') return 'pyOCD';
    if (key === 'openocd') return 'OpenOCD';
    if (key === 'commandTools') return (toolchainProfile.commandTools && toolchainProfile.commandTools.mode === 'busybox') ? '编译命令' : '系统命令';
    return key;
  }
  function toolStateText(key) {
    const p = toolProgress[key];
    if (p && (p.active || p.status === 'downloading' || p.status === 'installing')) return toolProgressText(key);
    if (p && p.status === 'error' && !toolReady(key)) return '失败';
    if (key === 'make' && defaultTc.makeBin === 'system') return '系统提供';
    if (key === 'commandTools' && toolchainProfile.commandTools && toolchainProfile.commandTools.mode === 'system') return '系统提供';
    if (key === 'pyocd' && toolReady(key)) return '本地已就绪';
    if (toolReady(key)) return '已就绪';
    return '未安装';
  }
  function toolTagType(key) {
    const p = toolProgress[key];
    if (p && p.status === 'error' && !toolReady(key)) return 'danger';
    if (p && (p.active || p.status === 'downloading' || p.status === 'installing')) return 'warning';
    if (toolReady(key)) return 'success';
    return 'info';
  }
  // 仅下载/安装/失败过程中显示进度条；已就绪时只展示状态，避免满条进度造成“还在下载”的错觉
  function showToolProgress(key) {
    const p = toolProgress[key];
    if (!p) return false;
    return !!(p.active || p.status === 'downloading' || p.status === 'installing' || (p.status === 'error' && !toolReady(key)));
  }
  function toolProgressPercent(key) {
    const p = toolProgress[key];
    if (!p) return 0;
    if (p.status === 'installing' && (p.percent | 0) >= 100) return 100;
    return Math.max(0, Math.min(100, p.percent | 0));
  }
  function toolProgressBarStatus(key) {
    const p = toolProgress[key];
    if (!p) return undefined;
    if (p.status === 'error') return 'exception';
    if (p.status === 'installing' && (p.percent | 0) >= 100) return 'success';
    return undefined;
  }
  const defaultToolchainItems = computed(() => (
    ['gcc', 'make', 'pyocd', 'openocd', 'commandTools'].map((key) => ({
      key,
      name: toolName(key),
      ready: toolReady(key),
      stateText: toolStateText(key),
      tagType: toolTagType(key),
      versionText: toolVersionText(key),
      showProgress: showToolProgress(key),
      percent: toolProgressPercent(key),
      progressStatus: toolProgressBarStatus(key)
    }))
  ));
  async function refreshPathEnv() {
    try {
      const s = await window.api.toolchainSystemPathStatus();
      Object.assign(pathEnv, {
        supported: s && s.supported !== false,
        present: !!(s && s.present),
        partial: !!(s && s.partial),
        dirs: (s && s.dirs) || [],
        matched: (s && s.matched) || [],
        missing: (s && s.missing) || [],
        message: (s && (s.message || s.error)) || '',
        label: (s && s.label) || '系统 PATH',
        profile: (s && s.profile) || '',
        scope: (s && s.scope) || ''
      });
    } catch (e) {
      pathEnv.supported = false;
      pathEnv.present = false;
      pathEnv.message = e && e.message ? e.message : String(e);
    }
  }
  async function addSystemPathEnv() {
    if (pathEnvBusy.value) return;
    pathEnvBusy.value = true;
    try {
      const r = await window.api.toolchainSystemPathAdd();
      await refreshPathEnv();
      if (r && r.ok) ElMessage.success(r.added && r.added.length ? `已写入 PATH（新增 ${r.added.length} 项）` : 'PATH 已包含工具链目录');
      else ElMessage.error((r && (r.error || r.message)) || '写入 PATH 失败');
    } catch (e) { ElMessage.error(e.message || String(e)); }
    pathEnvBusy.value = false;
  }
  async function removeSystemPathEnv() {
    if (pathEnvBusy.value) return;
    pathEnvBusy.value = true;
    try {
      const r = await window.api.toolchainSystemPathRemove();
      await refreshPathEnv();
      if (r && r.ok) ElMessage.success(r.removed && r.removed.length ? `已删除 PATH（${r.removed.length} 项）` : 'PATH 中无工具链目录');
      else ElMessage.error((r && (r.error || r.message)) || '删除 PATH 失败');
    } catch (e) { ElMessage.error(e.message || String(e)); }
    pathEnvBusy.value = false;
  }

  async function refreshDefaultTc() {
    try { Object.assign(defaultTc, await window.api.defaultToolchainStatus()); } catch {}
    await refreshPathEnv();
  }
  async function installDefaultTc(force = false) {
    installingDefault.value = true;
    dlProgress.active = true; dlProgress.percent = 0; dlProgress.label = '';
    resetToolProgress();
    // 预先标记可能下载/安装的项
    markToolProgress('gcc', { status: 'installing', note: force ? '准备下载…' : '检查中…', active: true, percent: 0 });
    markToolProgress('make', { status: 'installing', note: force ? '准备下载…' : '检查中…', active: true, percent: 0 });
    markToolProgress('openocd', { status: 'installing', note: force ? '准备下载…' : '检查中…', active: true, percent: 0 });
    markToolProgress('pyocd', { status: 'installing', note: '准备安装…', active: true, percent: 0 });
    if (toolchainProfile.commandTools && toolchainProfile.commandTools.mode === 'busybox') {
      markToolProgress('commandTools', { status: 'installing', note: '检查中…', active: true, percent: 0 });
    } else {
      markToolProgress('commandTools', { status: 'skip', note: '系统提供', active: false, percent: 100 });
    }
    try {
      const r = await window.api.installDefaultToolchain({ force: !!force });
      Object.assign(defaultTc, r);
      // 按结果刷新各工具状态
      markToolProgress('gcc', { status: r && r.gccBin ? 'done' : 'error', percent: r && r.gccBin ? 100 : toolProgress.gcc.percent, active: false, note: r && r.gccBin ? '完成' : '未就绪' });
      markToolProgress('make', { status: r && r.makeBin ? 'done' : (toolchainProfile.defaultDownloads?.make?.mode === 'system' ? 'skip' : 'error'), percent: 100, active: false, note: r && r.makeBin === 'system' ? '系统提供' : (r && r.makeBin ? '完成' : '未就绪') });
      markToolProgress('openocd', { status: r && r.openocdBin ? 'done' : 'error', percent: r && r.openocdBin ? 100 : toolProgress.openocd.percent, active: false, note: r && r.openocdBin ? '完成' : '未就绪' });
      markToolProgress('pyocd', { status: r && r.pyocdBin ? 'done' : 'error', percent: r && r.pyocdBin ? 100 : toolProgress.pyocd.percent, active: false, note: r && r.pyocdBin ? '完成' : '未就绪' });
      if (toolchainProfile.commandTools && toolchainProfile.commandTools.mode === 'busybox') {
        markToolProgress('commandTools', { status: r && r.busybox ? 'done' : 'error', percent: 100, active: false, note: r && r.busybox ? '完成' : '未就绪' });
      }
      await refreshPathEnv();
      if (r && r.ok) { ElMessage.success('默认工具链已就绪'); checkEnv(); }
      else ElMessage.error('安装未完全成功，详见日志');
    } catch (e) {
      appendLog({ text: `[异常] ${e.message}`, type: 'error' });
      for (const k of Object.keys(toolProgress)) {
        if (toolProgress[k].status === 'downloading' || toolProgress[k].status === 'installing') {
          markToolProgress(k, { status: 'error', active: false, note: '失败' });
        }
      }
    }
    installingDefault.value = false; dlProgress.active = false;
  }

  onMounted(() => {
    window.api.onDownloadProgress((p) => {
      const label = p && p.label ? p.label : '';
      const percent = p && typeof p.percent === 'number' ? p.percent : -1;
      dlProgress.label = label;
      if (percent >= 0) dlProgress.percent = percent;
      dlProgress.active = percent < 100;
      const key = mapProgressLabel(label);
      if (!key) return;
      if (percent < 0) markToolProgress(key, { status: 'downloading', active: true, note: '下载中…' });
      else if (percent >= 100) markToolProgress(key, { status: 'installing', active: true, percent: 100, note: '解压/安装中…' });
      else markToolProgress(key, { status: 'downloading', active: true, percent, note: `下载中 ${percent}%` });
    });
    refreshPathEnv();
  });

  function toolVersionText(key) {
    const map = {
      gcc: defaultTc.gccVersion,
      make: defaultTc.makeVersion,
      pyocd: defaultTc.pyocdVersion,
      openocd: defaultTc.openocdVersion,
      commandTools: defaultTc.busyboxVersion
    };
    return map[key] ? `v${map[key]}` : '';
  }

  function openToolDetail(kind) {
    const cmdLabel = toolchainProfile.commandTools && toolchainProfile.commandTools.mode === 'busybox' ? '编译命令' : '系统命令';
    const rowsByKind = {
      gcc: [
        ['状态', defaultTc.gccBin ? '已就绪' : '未安装'],
        ['版本', defaultTc.gccVersion || '未获取'],
        ['路径', defaultTc.gccBin || '未找到'],
        ['下载包', toolchainProfile.defaultDownloads?.gcc?.fileName || '当前系统无下载包']
      ],
      make: [
        ['状态', defaultTc.makeBin === 'system' ? '系统提供' : (defaultTc.makeBin ? '已就绪' : '未安装')],
        ['版本', defaultTc.makeVersion || '未获取'],
        ['路径', defaultTc.makeBin || '未找到'],
        ['来源', toolchainProfile.defaultDownloads?.make?.mode === 'system' ? '系统命令' : '默认工具链下载']
      ],
      pyocd: [
        ['状态', defaultTc.pyocdBin ? '本地已就绪' : '未安装'],
        ['版本', defaultTc.pyocdVersion || '未获取'],
        ['路径', defaultTc.pyocdBin || '未找到'],
        ['来源', '应用数据目录 toolchain/pyocd/（升级后保留）']
      ],
      openocd: [
        ['状态', defaultTc.openocdBin ? '本地已就绪' : '未安装'],
        ['版本', defaultTc.openocdVersion || '未获取'],
        ['路径', defaultTc.openocdBin || '未找到'],
        ['下载包', toolchainProfile.defaultDownloads?.openocd?.fileName || '当前系统无下载包']
      ],
      commandTools: [
        ['状态', toolchainProfile.commandTools?.mode === 'busybox' ? (defaultTc.busybox ? '已就绪' : '未安装') : '系统提供'],
        ['版本', defaultTc.busyboxVersion || (toolchainProfile.commandTools?.mode === 'system' ? '系统命令，无统一版本' : '未获取')],
        ['模式', toolchainProfile.commandTools?.mode || 'unknown'],
        ['平台', `${toolchainProfile.label || defaultTc.platform || '当前系统'} / ${defaultTc.platform || 'unknown'}`]
      ]
    };
    const titles = { gcc: 'ARM GCC', make: 'make', pyocd: 'pyOCD', openocd: 'OpenOCD', commandTools: cmdLabel };
    toolDetail.title = titles[kind] || '工具详情';
    toolDetail.rows = rowsByKind[kind] || [];
    toolDetail.commands = kind === 'commandTools' ? (defaultTc.commandTools || []) : [];
    toolDetail.visible = true;
  }

  return {
    platform, toolchainProfile, config, draft, settingsVisible,
    envReady, installing, installingDefault, defaultTc, dlProgress, toolDetail,
    toolProgress, pathEnv, pathEnvBusy, defaultToolchainItems,
    isWindows, isLinux, systemDisplayName, systemRuntimeLabel, systemDownloadLabel,
    envButtonText, envButtonReadyText, defaultInstallButtonText, defaultToolchainHint, defaultToolchainRootDisplay, chooseToolchainRoot, clearToolchainRoot,
    flashMethodModel, autoDetectModel, underResetModel,
    loadConfig, openSettings, closeSettings, saveSettings, resetSettings,
    checkEnv, installEnv, refreshDefaultTc, installDefaultTc,
    toolReady, toolProgressText, toolVersionText, openToolDetail,
    addSystemPathEnv, removeSystemPathEnv
  };
}
