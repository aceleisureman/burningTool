import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { now, copyText } from '../util.js';

const MAX_LOG_ENTRY_CHARS = 64 * 1024;
const MAX_LOG_HISTORY_CHARS = 4 * 1024 * 1024;
const LOG_HISTORY_TRIM_CHARS = 3 * 1024 * 1024;
const MAX_LOG_LINES = 2000;
const LOG_TRIM_LINES = 1500;

function clipLogText(value) {
  const text = String(value ?? '');
  return text.length > MAX_LOG_ENTRY_CHARS ? text.slice(0, MAX_LOG_ENTRY_CHARS) + '\n… [日志内容已截断]' : text;
}

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
  let logChars = 0;
  function applyLog(data) {
    data = data || {};
    const text = clipLogText(data.text);
    if (data.type === 'progress' && data.key) {
      const ln = progressByKey.get(data.key);
      if (ln) {
        logChars += text.length - (ln._weight || 0);
        ln.text = text;
        ln._weight = text.length;
        ln.ts = now();
        return;
      }
      const row = { id: ++logSeq, key: data.key, text, type: 'info', ts: now(), _weight: text.length };
      progressByKey.set(data.key, row);
      logLines.value.push(row);
      logChars += row._weight;
    } else {
      logLines.value.push({ id: ++logSeq, text, type: data.type || 'info', ts: now(), _weight: text.length });
      logChars += text.length;
    }
  }

  function trimLogHistory() {
    if (logLines.value.length <= MAX_LOG_LINES && logChars <= MAX_LOG_HISTORY_CHARS) return;
    let removeCount = 0;
    while (logLines.value.length - removeCount > 1 &&
           (logLines.value.length - removeCount > LOG_TRIM_LINES || logChars > LOG_HISTORY_TRIM_CHARS)) {
      const row = logLines.value[removeCount++];
      logChars -= row && row._weight ? row._weight : 0;
      if (row && row.key) progressByKey.delete(row.key);
    }
    if (removeCount) logLines.value.splice(0, removeCount);
    if (logChars < 0) logChars = 0;
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
    trimLogHistory();
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
    logChars = 0;
    lastResult.value = null;
  }
  async function copyLog() {
    const text = logLines.value.map((l) => `${l.ts} ${l.text}`).join('\n');
    try { await copyText(text); ElMessage.success('日志已复制'); } catch { ElMessage.error('复制失败'); }
  }

  let offLog = null;
  onMounted(() => { offLog = window.api.onLog((data) => appendLog(data)); });
  onBeforeUnmount(() => {
    if (typeof offLog === 'function') offLog();
    offLog = null;
    clearTimeout(flushTimer);
    flushTimer = null;
    pending = [];
    logBoxes.clear();
  });

  return { logLines, autoScroll, showTs, reverse, setLogBox, lastResult, displayLines, appendLog, clearLog, copyLog, scrollLog };
}
