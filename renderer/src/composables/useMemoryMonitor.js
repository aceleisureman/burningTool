import { ref, computed, onBeforeUnmount } from 'vue';

// 内存监控（设置页）：按固定间隔采样各进程内存，形成可回溯的日志，用于排查内存增长。
//
// 数据来源：
//   · 主进程侧经 IPC 采集（app.getAppMetrics）→ 主/渲染/GPU 进程工作集、峰值、私有字节、主进程 JS 堆
//   · 渲染层本地读 performance.memory → 渲染进程 JS 堆（used/total/limit）
// 两者互补：工作集反映真实物理内存占用，JS 堆反映 V8 托管内存（泄漏时通常先在这里体现）。

const MAX_SAMPLES = 300;                 // 滚动保留最近 300 条，避免长期采样撑爆内存
const DEFAULT_INTERVAL_MS = 2000;
const INTERVAL_OPTIONS = [
  { label: '1 秒', value: 1000 },
  { label: '2 秒', value: 2000 },
  { label: '5 秒', value: 5000 },
  { label: '10 秒', value: 10000 }
];

// Chromium 专有的 performance.memory（非标准，但 Electron 里稳定可用）
function readRendererHeap() {
  try {
    const m = typeof performance !== 'undefined' ? performance.memory : null;
    if (!m) return null;
    return {
      usedMb: Math.round((m.usedJSHeapSize / 1048576) * 10) / 10,
      totalMb: Math.round((m.totalJSHeapSize / 1048576) * 10) / 10,
      limitMb: Math.round((m.jsHeapSizeLimit / 1048576) * 10) / 10
    };
  } catch (_e) {
    return null;
  }
}

function pad2(n) {
  return String(n).padStart(2, '0');
}
function fmtTime(ts) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
function fmtFullTime(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${fmtTime(ts)}`;
}
// 把相对首个采样点的时间差格式化成 +m:ss，方便看增长速率
function fmtElapsed(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `+${m}:${pad2(s)}`;
}

export function useMemoryMonitor() {
  const memSupported = ref(typeof window !== 'undefined' && !!(window.api && window.api.memoryStats));
  const memSampling = ref(false);
  const memIntervalMs = ref(DEFAULT_INTERVAL_MS);
  const memSamples = ref([]);
  const memLatest = ref(null);
  const memError = ref('');
  const memGcBusy = ref(false);
  const memGcNote = ref('');
  let timer = null;

  // 滚动窗口的峰值与整体增长（用于快速判断「是否在持续涨」）
  const memPeakTotalMb = computed(() => memSamples.value.reduce((mx, s) => Math.max(mx, s.total || 0), 0));
  const memPeakHeapMb = computed(() => memSamples.value.reduce((mx, s) => Math.max(mx, s.heapUsed || 0), 0));
  const memGrowthMb = computed(() => {
    const n = memSamples.value.length;
    if (n < 2) return 0;
    return Math.round((memSamples.value[n - 1].total - memSamples.value[0].total) * 10) / 10;
  });
  // 表格展示：最新在上，并补齐展示用字段
  const memLogRows = computed(() => {
    const list = memSamples.value;
    if (!list.length) return [];
    const base = list[0].t;
    const rows = [];
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      rows.push({
        t: s.t,
        time: fmtTime(s.t),
        elapsed: fmtElapsed(s.t - base),
        total: s.total,
        main: s.main,
        renderer: s.renderer,
        gpu: s.gpu,
        heapUsed: s.heapUsed == null ? '—' : s.heapUsed,
        mainHeap: s.mainHeapUsed
      });
    }
    return rows;
  });
  const memIntervalOptions = INTERVAL_OPTIONS;

  // 采一次样；返回样本或 null
  async function memSampleNow() {
    if (!memSupported.value) {
      memError.value = '当前环境不支持内存采集';
      return null;
    }
    try {
      const r = await window.api.memoryStats();
      if (!r || !r.ok) {
        memError.value = (r && r.error) || '内存采集失败';
        return null;
      }
      const heap = readRendererHeap();
      const s = {
        t: r.at,
        total: r.totalWorkingSetMb,
        main: r.mainWorkingSetMb,
        renderer: r.rendererWorkingSetMb,
        gpu: r.gpuWorkingSetMb,
        heapUsed: heap ? heap.usedMb : null,
        heapTotal: heap ? heap.totalMb : null,
        heapLimit: heap ? heap.limitMb : null,
        mainHeapUsed: r.mainHeapUsedMb,
        mainHeapTotal: r.mainHeapTotalMb,
        mainRss: r.mainRssMb,
        processCount: r.processCount,
        uptimeSec: r.mainUptimeSec,
        processes: r.processes || []
      };
      memLatest.value = s;
      memSamples.value.push(s);
      if (memSamples.value.length > MAX_SAMPLES) {
        memSamples.value.splice(0, memSamples.value.length - MAX_SAMPLES);
      }
      memError.value = '';
      return s;
    } catch (e) {
      memError.value = String((e && e.message) || e);
      return null;
    }
  }

  function memStart() {
    if (memSampling.value) return;
    memSampling.value = true;
    memSampleNow();
    timer = setInterval(() => { memSampleNow(); }, memIntervalMs.value);
  }
  function memStop() {
    memSampling.value = false;
    if (timer) { clearInterval(timer); timer = null; }
  }
  function memToggle() {
    if (memSampling.value) memStop(); else memStart();
  }
  // 改间隔：采样中则立即按新间隔重建定时器
  function memSetInterval(ms) {
    const v = Number(ms) || DEFAULT_INTERVAL_MS;
    memIntervalMs.value = v;
    if (memSampling.value) {
      memStop();
      memStart();
    }
  }
  function memClear() {
    memSamples.value = [];
    memLatest.value = null;
    memGcNote.value = '';
  }

  function buildLogText() {
    const head = '时间\t运行时长\t合计MB\t主进程MB\t渲染MB\tGPU MB\t渲染JS堆MB\t主进程JS堆MB';
    const rows = memLogRows.value.map((r) =>
      [r.time, r.elapsed, r.total, r.main, r.renderer, r.gpu, r.heapUsed, r.mainHeap].join('\t')
    );
    return [head, ...rows].join('\n');
  }
  function buildCsv() {
    const head = 'timestamp,time,elapsed,total_mb,main_mb,renderer_mb,gpu_mb,renderer_heap_mb,main_heap_mb,process_count';
    const rows = memSamples.value.map((s) => [
      s.t, fmtFullTime(s.t), fmtElapsed(s.t - memSamples.value[0].t),
      s.total, s.main, s.renderer, s.gpu,
      s.heapUsed == null ? '' : s.heapUsed, s.mainHeapUsed, s.processCount
    ].join(','));
    return [head, ...rows].join('\n');
  }

  async function memCopyLog() {
    if (!memSamples.value.length) return false;
    try { await window.api.copyToClipboard(buildLogText()); memGcNote.value = '日志已复制到剪贴板'; return true; }
    catch (e) { memError.value = String((e && e.message) || e); return false; }
  }
  async function memExportCsv() {
    if (!memSamples.value.length) return false;
    try { await window.api.copyToClipboard(buildCsv()); memGcNote.value = 'CSV 已复制到剪贴板，可粘贴到 Excel 分析'; return true; }
    catch (e) { memError.value = String((e && e.message) || e); return false; }
  }

  async function memGc() {
    if (memGcBusy.value) return;
    memGcBusy.value = true;
    memGcNote.value = '';
    try {
      const r = await window.api.memoryGc();
      // 渲染进程 GC（需以 --js-flags=--expose-gc 启动；未开启时静默跳过）
      try { if (typeof window.gc === 'function') window.gc(); } catch (_e) { /* 忽略 */ }
      if (r && r.ok) memGcNote.value = '已触发 GC（主进程 + 渲染进程），下方采样可看到回收效果';
      else memGcNote.value = (r && (r.hint || r.note)) || 'GC 不可用';
      await memSampleNow();
    } catch (e) {
      memError.value = String((e && e.message) || e);
    } finally {
      memGcBusy.value = false;
    }
  }

  onBeforeUnmount(() => { memStop(); });

  return {
    memSupported, memSampling, memIntervalMs, memSamples, memLatest, memError,
    memGcBusy, memGcNote, memPeakTotalMb, memPeakHeapMb, memGrowthMb, memLogRows, memIntervalOptions,
    memSampleNow, memStart, memStop, memToggle, memSetInterval, memClear,
    memCopyLog, memExportCsv, memGc
  };
}
