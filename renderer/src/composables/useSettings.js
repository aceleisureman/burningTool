import { ref, reactive, computed, onMounted } from 'vue';

// 配置 / 平台 / 工具链：读取&保存配置、平台识别、编译环境与默认工具链安装
// deps: { appendLog, appShell:{tool,prevTool}, serial, mqtt }
export function useSettings(deps) {
  const { appendLog, appShell, serial, mqtt } = deps;

  const platform = ref('unknown');
  const toolchainProfile = reactive({ label: '', supportsKeil: false, commandTools: { mode: 'system' }, defaultDownloads: { gcc: {}, make: {} }, placeholders: {} });
  const config = reactive({ targetChip: 'stm32f103c8', elfName: '', flashMethod: 'pyocd' });
  const draft  = reactive({ armGccPath: '', makePath: '', pyocdPath: '', openocdPath: '', targetChip: '', elfName: '', autoDetectChip: true, connectUnderReset: false, toolchainMode: 'custom', ghProxy: '', buildSystem: 'auto', keilUV4Path: '', keilRebuild: false, cubeMxPath: '', flashMethod: 'pyocd' });
  const settingsVisible = ref(false);
  const envReady   = ref(false);
  const installing = ref(false);
  const installingDefault = ref(false);
  const defaultTc   = reactive({ gccBin: '', makeBin: '', busybox: false, pyocdBin: '', openocdBin: '' });
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
  const defaultToolchainHint = computed(() => {
    const label = toolchainProfile.label || '当前平台';
    if (draft.toolchainMode !== 'default') return `${label} 当前使用自定义路径，不会自动下载工具链。`;
    const makeMode = toolchainProfile.defaultDownloads && toolchainProfile.defaultDownloads.make && toolchainProfile.defaultDownloads.make.mode;
    if (makeMode === 'download') return '下载到用户数据目录 toolchain/（ARM GCC + make + OpenOCD + 编译命令），并创建本地 pyOCD。';
    return `${label} 默认下载 ARM GCC 到用户数据目录 toolchain/gcc/、OpenOCD 到 toolchain/openocd/，创建本地 pyOCD 到 toolchain/pyocd/；make 与 rm/mkdir/sh 等命令使用系统自带环境。`;
  });

  async function setFlashMethod(v) { config.flashMethod = v; try { Object.assign(config, await window.api.saveConfig({ flashMethod: v })); } catch (e) {} }
  async function setAutoDetect(v) { config.autoDetectChip = v; try { Object.assign(config, await window.api.saveConfig({ autoDetectChip: v })); } catch (e) {} }
  const flashMethodModel = computed({ get: () => config.flashMethod || 'pyocd', set: (v) => setFlashMethod(v) });
  const autoDetectModel  = computed({ get: () => config.autoDetectChip !== false, set: (v) => setAutoDetect(v) });
  async function setUnderReset(v) { config.connectUnderReset = v; try { Object.assign(config, await window.api.saveConfig({ connectUnderReset: v })); } catch (e) {} }
  const underResetModel  = computed({ get: () => config.connectUnderReset === true, set: (v) => setUnderReset(v) });

  async function loadConfig() {
    applyBrowserPlatformFallback();
    try { platform.value = await window.api.getPlatform(); } catch (e) { applyBrowserPlatformFallback(); }
    try { Object.assign(toolchainProfile, await window.api.getPlatformToolchain()); } catch (e) { applyBrowserPlatformFallback(); }
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
  async function refreshDefaultTc() { try { Object.assign(defaultTc, await window.api.defaultToolchainStatus()); } catch {} }
  async function installDefaultTc(force = false) {
    installingDefault.value = true; dlProgress.active = true; dlProgress.percent = 0; dlProgress.label = '';
    try { const r = await window.api.installDefaultToolchain({ force: !!force }); Object.assign(defaultTc, r); if (r && r.ok) { ElMessage.success('默认工具链已就绪'); checkEnv(); } else ElMessage.error('安装未完全成功，详见日志'); }
    catch (e) { appendLog({ text: `[异常] ${e.message}`, type: 'error' }); }
    installingDefault.value = false; dlProgress.active = false;
  }

  onMounted(() => {
    window.api.onDownloadProgress((p) => { dlProgress.label = p.label || ''; dlProgress.percent = p.percent < 0 ? dlProgress.percent : p.percent; dlProgress.active = p.percent < 100; });
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
        ['来源', '用户数据目录 toolchain/pyocd/']
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
    isWindows, isLinux, systemDisplayName, systemRuntimeLabel, systemDownloadLabel,
    envButtonText, envButtonReadyText, defaultInstallButtonText, defaultToolchainHint,
    flashMethodModel, autoDetectModel, underResetModel,
    loadConfig, openSettings, closeSettings, saveSettings, resetSettings,
    checkEnv, installEnv, refreshDefaultTc, installDefaultTc,
    toolVersionText, openToolDetail
  };
}
