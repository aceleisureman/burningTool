import { reactive, computed, onMounted } from 'vue';
import { baseName, portMainLabel, portSubLabel } from '../util.js';

const ESP_CHIPS = [
  { label: '自动探测', value: 'auto' },
  { label: 'ESP32', value: 'esp32' },
  { label: 'ESP32-S2', value: 'esp32s2' },
  { label: 'ESP32-S3', value: 'esp32s3' },
  { label: 'ESP32-C2', value: 'esp32c2' },
  { label: 'ESP32-C3', value: 'esp32c3' },
  { label: 'ESP32-C6', value: 'esp32c6' },
  { label: 'ESP32-H2', value: 'esp32h2' },
  { label: 'ESP32-P4', value: 'esp32p4' },
  { label: 'ESP8266', value: 'esp8266' }
];
const ESP_BAUDS = [115200, 230400, 460800, 921600, 1500000, 2000000];
const ESP_FLASH_MODES = ['keep', 'qio', 'qout', 'dio', 'dout'];
const ESP_FLASH_FREQS = ['keep', '80m', '40m', '26m', '20m'];
const ESP_FLASH_SIZES = ['detect', 'keep', '1MB', '2MB', '4MB', '8MB', '16MB', '32MB'];
const ESP_BEFORE = [
  { label: '默认复位', value: 'default_reset' },
  { label: 'USB 复位', value: 'usb_reset' },
  { label: '不复位', value: 'no_reset' },
  { label: '不复位不同步', value: 'no_reset_no_sync' }
];
const ESP_AFTER = [
  { label: '硬复位', value: 'hard_reset' },
  { label: '软复位', value: 'soft_reset' },
  { label: '不复位', value: 'no_reset' },
  { label: 'stub 不复位', value: 'no_reset_stub' }
];

export function useEsp32(deps = {}) {
  const { log, serial } = deps;
  const appendLog = log && log.appendLog ? log.appendLog : () => {};
  const lastResult = log && log.lastResult ? log.lastResult : { value: null };

  const esp32 = reactive({
    portPath: '',
    portLabel: '',
    portSub: '',
    chip: 'auto',
    baudRate: 460800,
    flashMode: 'keep',
    flashFreq: 'keep',
    flashSize: 'detect',
    beforeReset: 'default_reset',
    afterReset: 'hard_reset',
    eraseBeforeWrite: false,
    partMode: false,
    flashOffset: '0x0',
    firmwarePath: '',
    firmwareName: '',
    firmwareSize: 0,
    parts: [],
    toolOk: false,
    toolVersion: '',
    toolError: '',
    toolLocal: false,
    toolCommand: '',
    installing: false,
    busy: false,
    portsLoading: false,
    statusChecked: false,
    ports: []
  });

  const espHasFirmware = computed(() => esp32.partMode
    ? esp32.parts.some((p) => p && p.path)
    : !!esp32.firmwarePath);
  const espCanFlash = computed(() => !!esp32.portPath && espHasFirmware.value && !esp32.busy);
  const espStatusKind = computed(() => {
    if (esp32.busy) return 'busy';
    if (lastResult.value === 'ok') return 'ok';
    if (lastResult.value === 'err') return 'err';
    return esp32.toolOk ? '' : 'err';
  });
  const espStatusText = computed(() => {
    if (esp32.busy) return '下载中…';
    if (lastResult.value === 'ok') return '已完成';
    if (lastResult.value === 'err') return '失败';
    if (!esp32.statusChecked) return '未检测';
    return esp32.toolOk ? '就绪' : '缺少 esptool';
  });
  const espFirmwareLabel = computed(() => esp32.firmwareName || (esp32.firmwarePath ? baseName(esp32.firmwarePath) : '未选择固件'));
  function formatSize(n) {
    const size = Number(n) || 0;
    if (!size) return '—';
    if (size < 1024) return `${size} B`;
    return `${(size / 1024).toFixed(1)} KB`;
  }
  const espFirmwareSizeLabel = computed(() => formatSize(esp32.firmwareSize));

  function espPortLabel(p) {
    const sub = portSubLabel(p);
    return sub ? `${portMainLabel(p)} · ${sub}` : portMainLabel(p);
  }

  async function refreshEspPorts() {
    esp32.portsLoading = true;
    try {
      const r = await window.api.serialList();
      if (!r || !r.ok) {
        esp32.ports = [];
        ElMessage.error('枚举串口失败：' + ((r && r.error) || '未知错误'));
      } else {
        esp32.ports = r.ports || [];
        if (!esp32.portPath && esp32.ports.length === 1) pickEspPort(esp32.ports[0].path);
      }
    } catch (e) {
      ElMessage.error('枚举串口异常：' + (e.message || e));
    }
    esp32.portsLoading = false;
  }

  function pickEspPort(path) {
    esp32.portPath = path || '';
    const p = esp32.ports.find((item) => item.path === esp32.portPath);
    esp32.portLabel = p ? portMainLabel(p) : esp32.portPath;
    esp32.portSub = p ? portSubLabel(p) : '';
  }

  async function selectEspFirmware() {
    const file = await window.api.selectFirmwareFile();
    if (!file) return;
    esp32.firmwarePath = file.path || '';
    esp32.firmwareName = file.name || baseName(file.path || '');
    esp32.firmwareSize = Number(file.size) || 0;
    persistEsp32Config();
  }

  function addEspPart() {
    esp32.parts.push({ offset: '0x10000', path: '', name: '', size: 0 });
    persistEsp32Config();
  }

  function removeEspPart(i) {
    esp32.parts.splice(i, 1);
    persistEsp32Config();
  }

  async function selectEspPartFile(i) {
    const file = await window.api.selectFirmwareFile();
    if (!file || !esp32.parts[i]) return;
    esp32.parts[i].path = file.path || '';
    esp32.parts[i].name = file.name || baseName(file.path || '');
    esp32.parts[i].size = Number(file.size) || 0;
    persistEsp32Config();
  }

  async function checkEspTool(silent = false) {
    esp32.statusChecked = true;
    try {
      const r = await window.api.esp32ToolStatus();
      esp32.toolOk = !!(r && r.ok);
      esp32.toolVersion = r && r.version ? r.version : '';
      esp32.toolError = r && r.error ? r.error : '';
      esp32.toolLocal = !!(r && r.local);
      esp32.toolCommand = r && r.command ? r.command : '';
      if (esp32.toolOk && !silent) ElMessage.success('esptool 已就绪');
    } catch (e) {
      esp32.toolOk = false;
      esp32.toolError = e.message || String(e);
    }
  }

  async function installEspTool() {
    if (esp32.installing) return;
    esp32.installing = true;
    appendLog({ text: '[ESP32] 开始安装 esptool 到项目环境 toolchain/esptool …', type: 'step' });
    try {
      const r = await window.api.installEsptool({ force: false });
      if (r && r.ok) {
        ElMessage.success('esptool 已安装到项目环境');
        await checkEspTool(true);
      } else {
        ElMessage.error('安装 esptool 失败：' + ((r && r.error) || '详见日志'));
      }
    } catch (e) {
      appendLog({ text: `[ESP32] 安装异常: ${e.message || e}`, type: 'error' });
      ElMessage.error('安装 esptool 异常：' + (e.message || e));
    }
    esp32.installing = false;
  }

  function buildFlashOpts(extra = {}) {
    const opts = {
      portPath: esp32.portPath,
      chip: esp32.chip,
      baudRate: esp32.baudRate,
      flashMode: esp32.flashMode,
      flashFreq: esp32.flashFreq,
      flashSize: esp32.flashSize,
      beforeReset: esp32.beforeReset,
      afterReset: esp32.afterReset,
      eraseBeforeWrite: esp32.eraseBeforeWrite
    };
    if (esp32.partMode) opts.parts = esp32.parts.filter((p) => p && p.path).map((p) => ({ offset: p.offset, path: p.path }));
    else { opts.firmwarePath = esp32.firmwarePath; opts.flashOffset = esp32.flashOffset; }
    return Object.assign(opts, extra);
  }

  async function runEspOp(opts, successMsg) {
    if (!esp32.portPath) { ElMessage.warning('请先选择串口'); return; }
    if (serial && serial.serial && serial.serial.connected && serial.serial.portPath === esp32.portPath) {
      ElMessage.warning('当前串口调试正在占用该端口，请先断开串口调试');
      return;
    }
    esp32.busy = true;
    lastResult.value = null;
    persistEsp32Config();
    try {
      const r = await window.api.flashEsp32(opts);
      lastResult.value = r && r.ok ? 'ok' : 'err';
      if (r && r.ok) ElMessage.success(successMsg);
      else ElMessage.error((r && r.error) || 'esptool 操作失败，详见日志');
      checkEspTool(true);
    } catch (e) {
      appendLog({ text: `[ESP32] 异常: ${e.message || e}`, type: 'error' });
      lastResult.value = 'err';
    }
    esp32.busy = false;
  }

  async function doEspFlash() {
    if (!espHasFirmware.value) { ElMessage.warning('请先选择固件'); return; }
    await runEspOp(buildFlashOpts(), 'ESP32 烧录完成');
  }

  async function doEspErase() {
    await runEspOp(buildFlashOpts({ eraseOnly: true }), 'ESP32 擦除完成');
  }

  async function doEspReadMac() {
    await runEspOp(buildFlashOpts({ readMacOnly: true }), 'ESP32 读取 MAC 完成');
  }

  function persistEsp32Config() {
    try {
      window.api.saveConfig({
        esp32Config: {
          portPath: esp32.portPath,
          chip: esp32.chip,
          baudRate: esp32.baudRate,
          flashMode: esp32.flashMode,
          flashFreq: esp32.flashFreq,
          flashSize: esp32.flashSize,
          beforeReset: esp32.beforeReset,
          afterReset: esp32.afterReset,
          eraseBeforeWrite: esp32.eraseBeforeWrite,
          partMode: esp32.partMode,
          flashOffset: esp32.flashOffset,
          firmwarePath: esp32.firmwarePath,
          parts: esp32.parts.map((p) => ({ offset: p.offset, path: p.path }))
        }
      }).catch(() => {});
    } catch (e) {}
  }

  async function initEsp32FromConfig() {
    try {
      const cfg = await window.api.getConfig();
      const saved = cfg && cfg.esp32Config ? cfg.esp32Config : {};
      Object.assign(esp32, {
        portPath: saved.portPath || '',
        chip: saved.chip || 'auto',
        baudRate: Number(saved.baudRate) || 460800,
        flashMode: saved.flashMode || 'keep',
        flashFreq: saved.flashFreq || 'keep',
        flashSize: saved.flashSize || 'detect',
        beforeReset: saved.beforeReset || 'default_reset',
        afterReset: saved.afterReset || 'hard_reset',
        eraseBeforeWrite: saved.eraseBeforeWrite === true,
        partMode: saved.partMode === true,
        flashOffset: saved.flashOffset || '0x0',
        firmwarePath: saved.firmwarePath || '',
        firmwareName: saved.firmwarePath ? baseName(saved.firmwarePath) : '',
        parts: Array.isArray(saved.parts)
          ? saved.parts.map((p) => ({ offset: p.offset || '0x0', path: p.path || '', name: p.path ? baseName(p.path) : '', size: 0 }))
          : []
      });
    } catch (e) {}
  }

  onMounted(() => {
    initEsp32FromConfig().then(() => refreshEspPorts());
    checkEspTool(true);
  });

  return {
    esp32, ESP_CHIPS, ESP_BAUDS, ESP_FLASH_MODES, ESP_FLASH_FREQS, ESP_FLASH_SIZES, ESP_BEFORE, ESP_AFTER,
    espCanFlash, espHasFirmware, espStatusKind, espStatusText, espFirmwareLabel, espFirmwareSizeLabel,
    persistEsp32Config, refreshEspPorts, pickEspPort, selectEspFirmware, addEspPart, removeEspPart, selectEspPartFile,
    checkEspTool, installEspTool, doEspFlash, doEspErase, doEspReadMac, espPortLabel
  };
}
