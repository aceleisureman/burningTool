import { reactive, computed, watch } from 'vue';
import { calcCrc, listCrcAlgorithms, parseCrcInput, copyText, bytesToHex } from '../util.js';

export function useCrc() {
  const crc = reactive({
    algo: 'crc16_modbus',
    inputMode: 'hex',
    input: '01 03 00 00 00 0A',
    invert: false,
    appendResult: true,
    error: '',
    result: null,
    history: [],
  });

  const crcAlgorithms = listCrcAlgorithms();
  const crcPreviewBytes = computed(() => {
    try {
      const bytes = parseCrcInput(crc.input, crc.inputMode);
      return {
        ok: true,
        bytes,
        hex: bytesToHex(bytes),
        length: bytes.length,
      };
    } catch (e) {
      return { ok: false, error: e.message || String(e), bytes: new Uint8Array(), hex: '', length: 0 };
    }
  });

  const crcFrameHex = computed(() => {
    if (!crc.result) return '';
    const body = crcPreviewBytes.value.ok ? crcPreviewBytes.value.hex : '';
    if (!crc.appendResult) return body;
    return [body, crc.result.bytesHex].filter(Boolean).join(' ').trim();
  });

  function recomputeCrc() {
    try {
      const bytes = parseCrcInput(crc.input, crc.inputMode);
      const result = calcCrc(crc.algo, bytes, { invert: crc.invert });
      crc.error = '';
      crc.result = result;
    } catch (e) {
      crc.error = e.message || String(e);
      crc.result = null;
    }
  }

  function pushCrcHistory() {
    if (!crc.result) return;
    crc.history.unshift({
      id: Date.now() + Math.random(),
      algo: crc.result.label,
      input: (crcPreviewBytes.value.hex || '').slice(0, 80),
      hex: crc.result.hexPrefixed,
      value: crc.result.value,
      length: crc.result.length,
      time: new Date().toLocaleTimeString(),
    });
    if (crc.history.length > 12) crc.history.length = 12;
  }

  async function copyCrcResult(kind = 'hex') {
    if (!crc.result) { ElMessage.warning('暂无校验结果'); return; }
    const map = {
      hex: crc.result.hexPrefixed,
      raw: crc.result.hex,
      bytes: crc.result.bytesHex,
      frame: crcFrameHex.value,
    };
    try {
      await copyText(map[kind] || crc.result.hexPrefixed);
      ElMessage.success('已复制');
    } catch {
      ElMessage.error('复制失败');
    }
  }

  function clearCrcInput() {
    crc.input = '';
    recomputeCrc();
  }

  function useSampleCrc() {
    crc.inputMode = 'hex';
    crc.algo = 'crc16_modbus';
    crc.input = '01 03 00 00 00 0A';
    recomputeCrc();
  }

  watch(() => [crc.algo, crc.inputMode, crc.input, crc.invert], () => {
    recomputeCrc();
  }, { immediate: true });

  return {
    crc,
    crcAlgorithms,
    crcPreviewBytes,
    crcFrameHex,
    recomputeCrc,
    pushCrcHistory,
    copyCrcResult,
    clearCrcInput,
    useSampleCrc,
  };
}
