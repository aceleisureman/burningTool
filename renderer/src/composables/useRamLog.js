import { reactive, ref, computed, nextTick, onBeforeUnmount } from 'vue';
import { copyText } from '../util.js';

export function useRamLog(deps) {
  const { settings } = deps;
  const ramLog = reactive({
    running: false, busy: false, lastOk: null, error: '', notice: '',
    base: '0x20004800', magic: '0x524C4F47', size: 1024, interval: 500,
    encoding: 'utf-8', ring: true, autoScroll: true, advanced: false,
    offsets: { magic: 0, version: 4, size: 8, writePos: 12, seq: 16, data: 20 },
    meta: { magicOk: false, magicHex: '', version: null, size: 0, writePos: null, seq: null },
    text: '', pyocd: '', target: ''
  });
  const ramLogBox = ref(null);
  let ramLogTimer = null;

  const ramLogStatusKind = computed(() => {
    if (ramLog.error) return 'err';
    if (ramLog.notice) return '';
    if (ramLog.busy && !ramLog.running) return 'busy';
    return ramLog.lastOk === true ? 'ok' : (ramLog.lastOk === false ? 'err' : '');
  });
  const ramLogStatusText = computed(() => {
    if (ramLog.error) return '读取失败';
    if (ramLog.notice) return '等待 RLOG';
    if (ramLog.busy && !ramLog.running) return '读取中…';
    if (ramLog.running) return '轮询中';
    if (ramLog.lastOk === true) return ramLog.meta.magicOk ? '已同步' : 'Magic 不匹配';
    if (ramLog.lastOk === false) return '读取失败';
    return '待读取';
  });

  function applyConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return;
    Object.assign(ramLog, cfg);
    ramLog.offsets = Object.assign({ magic: 0, version: 4, size: 8, writePos: 12, seq: 16, data: 20 }, cfg.offsets || {});
  }
  function ramLogPlainConfig() {
    return {
      base: ramLog.base,
      magic: ramLog.magic,
      size: Number(ramLog.size) || 1024,
      interval: Number(ramLog.interval) || 500,
      encoding: ramLog.encoding || 'utf-8',
      ring: ramLog.ring !== false,
      offsets: Object.assign({}, ramLog.offsets)
    };
  }
  function scrollRamLog() {
    nextTick(() => {
      const el = ramLogBox.value;
      if (el && ramLog.autoScroll) el.scrollTop = el.scrollHeight;
    });
  }
  async function readRamLogOnce() {
    if (ramLog.busy) return;
    ramLog.busy = true;
    try {
      const r = await window.api.readRamLog(ramLogPlainConfig());
      ramLog.pyocd = r.pyocd || '';
      ramLog.target = r.target || '';
      if (r.meta) Object.assign(ramLog.meta, r.meta);
      if (r && r.text != null) ramLog.text = r.text;
      if (r && r.ok) {
        ramLog.lastOk = true; ramLog.error = ''; ramLog.notice = '';
      } else if (r && r.meta && !r.meta.magicOk) {
        ramLog.lastOk = null; ramLog.error = '';
        ramLog.notice = `未检测到 RLOG：读取到 ${r.meta.magicHex}，期望 ${r.meta.expectedMagicHex}。请确认固件结构地址一致。`;
      } else {
        ramLog.lastOk = false; ramLog.notice = ''; ramLog.error = (r && r.error) || '读取失败';
      }
      scrollRamLog();
    } catch (e) {
      ramLog.lastOk = false; ramLog.notice = ''; ramLog.error = e.message || String(e);
    }
    ramLog.busy = false;
  }
  function stopRamLog() {
    if (ramLogTimer) clearInterval(ramLogTimer);
    ramLogTimer = null;
    ramLog.running = false;
  }
  async function startRamLog() {
    if (ramLog.running) return;
    ramLog.running = true;
    await readRamLogOnce();
    ramLogTimer = setInterval(() => {
      if (!ramLog.busy) readRamLogOnce();
    }, Math.max(200, Number(ramLog.interval) || 500));
  }
  function toggleRamLog() {
    if (ramLog.running) stopRamLog();
    else startRamLog();
  }
  async function saveRamLogConfig() {
    try {
      const saved = await window.api.saveConfig({ ramLogConfig: ramLogPlainConfig() });
      if (saved && saved.ramLogConfig) applyConfig(saved.ramLogConfig);
      if (settings && settings.config && saved) Object.assign(settings.config, saved);
      ElMessage.success('内存日志配置已保存');
    } catch (e) {
      ElMessage.error('保存失败：' + (e.message || e));
    }
  }
  async function copyRamLog() {
    try { await copyText(ramLog.text || ''); ElMessage.success('内存日志已复制'); }
    catch { ElMessage.error('复制失败'); }
  }
  function clearRamLog() {
    ramLog.text = '';
    ramLog.error = '';
    ramLog.notice = '';
    ramLog.lastOk = null;
  }

  onBeforeUnmount(() => stopRamLog());

  return {
    ramLog, ramLogBox, ramLogStatusKind, ramLogStatusText,
    applyRamLogConfig: applyConfig,
    readRamLogOnce, toggleRamLog, saveRamLogConfig, copyRamLog, clearRamLog
  };
}
