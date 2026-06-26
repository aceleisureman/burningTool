import { ref, computed, nextTick, onMounted } from 'vue';
import { now, copyText } from '../util.js';

// 烧录台终端日志：收集 onLog 推送、倒/正序展示、复制、清空，封顶 2000 行
export function useLog() {
  const logLines = ref([]);
  const autoScroll = ref(true);
  const showTs = ref(true);
  const reverse = ref(true);
  const logBox = ref(null);
  const lastResult = ref(null);
  let logSeq = 0;

  const displayLines = computed(() => reverse.value ? logLines.value.slice().reverse() : logLines.value);

  function scrollLog() { nextTick(() => { const el = logBox.value; if (el) el.scrollTop = reverse.value ? 0 : el.scrollHeight; }); }
  function appendLog(data) {
    if (data.type === 'progress' && data.key) {
      const ln = logLines.value.find((l) => l.key === data.key);
      if (ln) { ln.text = data.text; ln.ts = now(); if (autoScroll.value) scrollLog(); return; }
      logLines.value.push({ id: ++logSeq, key: data.key, text: data.text, type: 'info', ts: now() });
    } else {
      logLines.value.push({ id: ++logSeq, text: data.text, type: data.type || 'info', ts: now() });
    }
    if (logLines.value.length > 2000) logLines.value.splice(0, 500);
    if (autoScroll.value) scrollLog();
  }
  function clearLog() { logLines.value = []; lastResult.value = null; }
  async function copyLog() {
    const text = logLines.value.map((l) => `${l.ts} ${l.text}`).join('\n');
    try { await copyText(text); ElMessage.success('日志已复制'); } catch { ElMessage.error('复制失败'); }
  }

  onMounted(() => {
    window.api.onLog((data) => appendLog(data));
  });

  return { logLines, autoScroll, showTs, reverse, logBox, lastResult, displayLines, appendLog, clearLog, copyLog, scrollLog };
}
