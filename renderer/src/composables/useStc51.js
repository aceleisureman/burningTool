import { ref, reactive, computed, onMounted } from 'vue';
import { baseName, portMainLabel, portSubLabel } from '../util.js';

const STC_PROTOCOLS = [
  { label: '自动识别', value: 'auto' },
  { label: 'STC89/90', value: 'stc89' },
  { label: 'STC89A', value: 'stc89a' },
  { label: 'STC12A', value: 'stc12a' },
  { label: 'STC12B', value: 'stc12b' },
  { label: 'STC12', value: 'stc12' },
  { label: 'STC15A', value: 'stc15a' },
  { label: 'STC15', value: 'stc15' },
  { label: 'STC8', value: 'stc8' },
  { label: 'STC8D', value: 'stc8d' },
  { label: 'STC8G', value: 'stc8g' },
  { label: 'USB15', value: 'usb15' }
];

const STC_RESET_PINS = [
  { label: 'DTR', value: 'dtr' },
  { label: 'RTS', value: 'rts' },
  { label: 'DTR 反相', value: 'dtr_inverted' },
  { label: 'RTS 反相', value: 'rts_inverted' }
];

export function useStc51(deps = {}) {
  const { log, serial } = deps;
  const appendLog = log && log.appendLog ? log.appendLog : () => {};
  const lastResult = log && log.lastResult ? log.lastResult : ref(null);

  const stc51 = reactive({
    portPath: '',
    portLabel: '',
    portSub: '',
    protocol: 'auto',
    baudRate: 115200,
    handshakeBaud: 2400,
    firmwarePath: '',
    firmwareName: '',
    firmwareSize: 0,
    eepromPath: '',
    eepromName: '',
    eepromSize: 0,
    eraseOnly: false,
    autoReset: false,
    resetPin: 'dtr',
    resetCmd: '',
    trimKHz: '',
    optionsText: '',
    debug: false,
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

  const stcBaudRates = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];
  const stcHandshakeRates = [1200, 2400, 4800, 9600];
  const stcCanFlash = computed(() => (stc51.protocol === 'usb15' || !!stc51.portPath) && (stc51.eraseOnly || !!stc51.firmwarePath) && !stc51.busy);
  const stcStatusKind = computed(() => {
    if (stc51.busy) return 'busy';
    if (lastResult.value === 'ok') return 'ok';
    if (lastResult.value === 'err') return 'err';
    return stc51.toolOk ? '' : 'err';
  });
  const stcStatusText = computed(() => {
    if (stc51.busy) return '下载中…';
    if (lastResult.value === 'ok') return '已完成';
    if (lastResult.value === 'err') return '失败';
    if (!stc51.statusChecked) return '未检测';
    return stc51.toolOk ? '就绪' : '缺少 stcgal';
  });
  const stcFirmwareLabel = computed(() => stc51.firmwareName || (stc51.firmwarePath ? baseName(stc51.firmwarePath) : '未选择固件'));
  function formatSize(n) {
    const size = Number(n) || 0;
    if (!size) return '—';
    if (size < 1024) return `${size} B`;
    return `${(size / 1024).toFixed(1)} KB`;
  }

  const stcFirmwareSizeLabel = computed(() => formatSize(stc51.firmwareSize));
  const stcEepromLabel = computed(() => stc51.eepromName || (stc51.eepromPath ? baseName(stc51.eepromPath) : '未选择 EEPROM/IAP 镜像'));
  const stcEepromSizeLabel = computed(() => formatSize(stc51.eepromSize));

  function stcPortLabel(p) {
    const sub = portSubLabel(p);
    return sub ? `${portMainLabel(p)} · ${sub}` : portMainLabel(p);
  }

  async function refreshStcPorts() {
    stc51.portsLoading = true;
    try {
      const r = await window.api.serialList();
      if (!r || !r.ok) {
        stc51.ports = [];
        ElMessage.error('枚举串口失败：' + ((r && r.error) || '未知错误'));
      } else {
        stc51.ports = r.ports || [];
        if (!stc51.portPath && stc51.ports.length === 1) pickStcPort(stc51.ports[0].path);
      }
    } catch (e) {
      ElMessage.error('枚举串口异常：' + (e.message || e));
    }
    stc51.portsLoading = false;
  }

  function pickStcPort(path) {
    stc51.portPath = path || '';
    const p = stc51.ports.find((item) => item.path === stc51.portPath);
    stc51.portLabel = p ? portMainLabel(p) : stc51.portPath;
    stc51.portSub = p ? portSubLabel(p) : '';
  }

  async function selectStcFirmware() {
    const file = await window.api.selectFirmwareFile();
    if (!file) return;
    stc51.firmwarePath = file.path || '';
    stc51.firmwareName = file.name || baseName(file.path || '');
    stc51.firmwareSize = Number(file.size) || 0;
    persistStc51Config();
  }

  async function selectStcEeprom() {
    const file = await window.api.selectFirmwareFile();
    if (!file) return;
    stc51.eepromPath = file.path || '';
    stc51.eepromName = file.name || baseName(file.path || '');
    stc51.eepromSize = Number(file.size) || 0;
    persistStc51Config();
  }

  function clearStcEeprom() {
    stc51.eepromPath = '';
    stc51.eepromName = '';
    stc51.eepromSize = 0;
    persistStc51Config();
  }

  async function checkStcTool(silent = false) {
    stc51.statusChecked = true;
    try {
      const r = await window.api.stc51ToolStatus();
      stc51.toolOk = !!(r && r.ok);
      stc51.toolVersion = r && r.version ? r.version : '';
      stc51.toolError = r && r.error ? r.error : '';
      stc51.toolLocal = !!(r && r.local);
      stc51.toolCommand = r && r.command ? r.command : '';
      if (stc51.toolOk && !silent) ElMessage.success('StcGal 已就绪');
    } catch (e) {
      stc51.toolOk = false;
      stc51.toolError = e.message || String(e);
    }
  }

  async function installStcTool() {
    if (stc51.installing) return;
    stc51.installing = true;
    appendLog({ text: '[StcGal] 开始安装 stcgal 到项目环境 toolchain/stcgal …', type: 'step' });
    try {
      const r = await window.api.installStcgal({ force: false });
      if (r && r.ok) {
        ElMessage.success('stcgal 已安装到项目环境');
        await checkStcTool(true);
      } else {
        ElMessage.error('安装 stcgal 失败：' + ((r && r.error) || '详见日志'));
      }
    } catch (e) {
      appendLog({ text: `[StcGal] 安装异常: ${e.message || e}`, type: 'error' });
      ElMessage.error('安装 stcgal 异常：' + (e.message || e));
    }
    stc51.installing = false;
  }

  async function doStcFlash() {
    if (stc51.protocol !== 'usb15' && !stc51.portPath) { ElMessage.warning('请先选择串口'); return; }
    if (!stc51.eraseOnly && !stc51.firmwarePath) { ElMessage.warning('请先选择代码镜像，或开启仅擦除'); return; }
    if (serial && serial.serial && serial.serial.connected && serial.serial.portPath === stc51.portPath) {
      ElMessage.warning('当前串口调试正在占用该端口，请先断开串口调试');
      return;
    }

    stc51.busy = true;
    lastResult.value = null;
    persistStc51Config();
    try {
      const r = await window.api.flashStc51({
        portPath: stc51.portPath,
        firmwarePath: stc51.firmwarePath,
        eepromPath: stc51.eepromPath,
        protocol: stc51.protocol,
        baudRate: stc51.baudRate,
        handshakeBaud: stc51.handshakeBaud,
        eraseOnly: stc51.eraseOnly,
        autoReset: stc51.autoReset,
        resetPin: stc51.resetPin,
        resetCmd: stc51.resetCmd,
        trimKHz: stc51.trimKHz,
        optionsText: stc51.optionsText,
        debug: stc51.debug
      });
      lastResult.value = r && r.ok ? 'ok' : 'err';
      if (r && r.ok) ElMessage.success('StcGal 操作完成');
      else ElMessage.error((r && r.error) || 'StcGal 操作失败，详见日志');
      checkStcTool();
    } catch (e) {
      appendLog({ text: `[StcGal] 异常: ${e.message || e}`, type: 'error' });
      lastResult.value = 'err';
    }
    stc51.busy = false;
  }

  function persistStc51Config() {
    try {
      window.api.saveConfig({
        stc51Config: {
          portPath: stc51.portPath,
          protocol: stc51.protocol,
          baudRate: stc51.baudRate,
          handshakeBaud: stc51.handshakeBaud,
          firmwarePath: stc51.firmwarePath,
          eepromPath: stc51.eepromPath,
          eraseOnly: stc51.eraseOnly,
          autoReset: stc51.autoReset,
          resetPin: stc51.resetPin,
          resetCmd: stc51.resetCmd,
          trimKHz: stc51.trimKHz,
          optionsText: stc51.optionsText,
          debug: stc51.debug
        }
      }).catch(() => {});
    } catch (e) {}
  }

  async function initStc51FromConfig() {
    try {
      const cfg = await window.api.getConfig();
      const saved = cfg && cfg.stc51Config ? cfg.stc51Config : {};
      Object.assign(stc51, {
        portPath: saved.portPath || '',
        protocol: saved.protocol || 'auto',
        baudRate: Number(saved.baudRate) || 115200,
        handshakeBaud: Number(saved.handshakeBaud) || 2400,
        firmwarePath: saved.firmwarePath || '',
        firmwareName: saved.firmwarePath ? baseName(saved.firmwarePath) : '',
        eepromPath: saved.eepromPath || '',
        eepromName: saved.eepromPath ? baseName(saved.eepromPath) : '',
        eraseOnly: saved.eraseOnly === true,
        autoReset: saved.autoReset === true,
        resetPin: saved.resetPin || 'dtr',
        resetCmd: saved.resetCmd || '',
        trimKHz: saved.trimKHz || '',
        optionsText: saved.optionsText || '',
        debug: saved.debug === true
      });
    } catch (e) {}
  }

  onMounted(() => {
    initStc51FromConfig().then(() => refreshStcPorts());
    checkStcTool();
  });

  return {
    stc51, stcBaudRates, stcHandshakeRates, STC_PROTOCOLS, STC_RESET_PINS,
    stcCanFlash, stcStatusKind, stcStatusText, stcFirmwareLabel, stcFirmwareSizeLabel, stcEepromLabel, stcEepromSizeLabel,
    persistStc51Config, refreshStcPorts, pickStcPort, selectStcFirmware, selectStcEeprom, clearStcEeprom, checkStcTool, installStcTool, doStcFlash, stcPortLabel
  };
}
