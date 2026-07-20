import { ref, computed, nextTick, onMounted } from 'vue';
import { now, copyText } from '../util.js';

// 烧录台终端日志：收集 onLog 推送、倒/正序展示、复制、清空，封顶 2000 行
export function useLog() {
  const logLines = ref([]);
  const autoScroll = ref(true);
  const showTs = ref(true);
  const reverse = ref(true);
  // 三个面板（flash/stc51/esp32）各自的日志容器：按面板名注册，避免同名字符串 ref 互相覆盖；
  // 容器随 v-if 重新挂载时按当前模式定位一次（倒序=顶部，正序=底部）
  const logBoxes = new Map();
  function setLogBox(pane, el) {
    if (!el) { logBoxes.delete(pane); return; }   // v-if 卸载时清掉，避免 scroll 访问死节点
    logBoxes.set(pane, el);
    if (autoScroll.value) el.scrollTop = reverse.value ? 0 : el.scrollHeight;
  }
  const lastResult = ref(null);
  let logSeq = 0;

  const displayLines = computed(() => reverse.value ? logLines.value.slice().reverse() : logLines.value);

  function scrollLog() {
    nextTick(() => {
      for (const el of logBoxes.values()) {
        if (el) el.scrollTop = reverse.value ? 0 : el.scrollHeight;
      }
    });
  }

  // 单条日志落入响应式数组（不触发滚动，滚动由 flush 统一做一次）
  // progress 行用 Map 按 key 索引，避免每批都线性 find
  const progressByKey = new Map();
  function applyLog(data) {
    if (data.type === 'progress' && data.key) {
      const ln = progressByKey.get(data.key);
      if (ln) { ln.text = data.text; ln.ts = now(); return; }
      const row = { id: ++logSeq, key: data.key, text: data.text, type: 'info', ts: now() };
      progressByKey.set(data.key, row);
      logLines.value.push(row);
    } else {
      logLines.value.push({ id: ++logSeq, text: data.text, type: data.type || 'info', ts: now() });
    }
  }

  // 编译时 make/gcc 每秒推送上百行，逐行触发 Vue 更新会把界面卡死：
  // 先积攒到普通数组，每 50ms 批量落入响应式数组，一批只重渲染/滚动一次
  let pending = [];
  let flushTimer = null;
  function flushLog() {
    flushTimer = null;
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    for (const data of batch) applyLog(data);
    if (logLines.value.length > 2000) {
      const removed = logLines.value.splice(0, logLines.value.length - 1500);
      for (const r of removed) if (r.key) progressByKey.delete(r.key);
    }
    if (autoScroll.value) scrollLog();
  }
  function appendLog(data) {
    if (Array.isArray(data)) pending.push(...data);   // 主进程按 30ms 攒批推送的数组
    else pending.push(data);
    if (!flushTimer) flushTimer = setTimeout(flushLog, 50);
  }
  function clearLog() {
    pending = [];
    progressByKey.clear();
    logLines.value = [];
    lastResult.value = null;
  }
  async function copyLog() {
    const text = logLines.value.map((l) => `${l.ts} ${l.text}`).join('\n');
    try { await copyText(text); ElMessage.success('日志已复制'); } catch { ElMessage.error('复制失败'); }
  }

  onMounted(() => {
    window.api.onLog((data) => appendLog(data));
  });

  return { logLines, autoScroll, showTs, reverse, setLogBox, lastResult, displayLines, appendLog, clearLog, copyLog, scrollLog };
}
