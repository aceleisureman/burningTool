// 主进程启动性能探针：记录「进程启动 → 主窗口创建 → 首屏就绪」各阶段耗时。
//
// 存在意义：截图里「窗口边框有、内容白」说明主窗口对象建好了但渲染层还没画。
// 而主进程侧的同步任务（工具链版本探测 spawnSync×5、PATH 遍历、reg 查询）
// 会独占 event loop，期间 BrowserWindow 即便创建了也拿不到 CPU 去合成首帧。
// 把这些耗时量化出来，才谈得上优化。
//
// 设计原则：
//  - 零依赖、无副作用：仅在内存里打点，不写磁盘、不改行为
//  - 默认关闭：设 MCU_STARTUP_PROFILE=1 开启，避免正式运行有额外开销
//  - 计时用 hrtime（单调时钟，不受系统时间调整影响）
//  - 记录首次绘制里程碑：渲染层通过 IPC 回报 'startup-mark' 时落点
'use strict';

const { performance } = require('perf_hooks');

const ENABLED = String(process.env.MCU_STARTUP_PROFILE || '').trim() === '1';
const ORIGIN = performance.now();

const stages = [];          // { name, at, durMs }
const marks = new Map();    // name -> at
const slowSyncOps = [];     // 超过阈值的同步操作
const SLOW_OP_MS = Number(process.env.MCU_STARTUP_SLOW_MS || 60);

function nowRel() {
  return performance.now() - ORIGIN;
}

/**
 * 打一个阶段点。重复名只保留首次。
 * @param {string} name
 */
function mark(name) {
  if (!ENABLED) return nowRel();
  const at = nowRel();
  if (!marks.has(name)) {
    marks.set(name, at);
    stages.push({ name, at: Math.round(at), durMs: null });
  }
  return at;
}

/**
 * 包住一段同步逻辑，测其耗时并登记（超过阈值则额外记入 slowSyncOps）。
 * 用法：profile.span('toolchain:default-status', () => defaultToolchainStatus())
 * @template T
 * @param {string} name
 * @param {() => T} fn
 * @returns {T}
 */
function span(name, fn) {
  if (!ENABLED) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    const dur = performance.now() - t0;
    stages.push({ name, at: Math.round(t0 - ORIGIN), durMs: Math.round(dur) });
    if (dur >= SLOW_OP_MS) {
      slowSyncOps.push({ name, durMs: Math.round(dur), at: Math.round(t0 - ORIGIN) });
    }
  }
}

/**
 * 包住一段异步逻辑。
 * @template T
 * @param {string} name
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function spanAsync(name, fn) {
  if (!ENABLED) return fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    const dur = performance.now() - t0;
    stages.push({ name, at: Math.round(t0 - ORIGIN), durMs: Math.round(dur) });
    if (dur >= SLOW_OP_MS) {
      slowSyncOps.push({ name, durMs: Math.round(dur), at: Math.round(t0 - ORIGIN) });
    }
  }
}

/**
 * 记录渲染层回报的里程碑（经 IPC）。用于把「HTML 响应」「首屏可见」等
 * 渲染端时刻并入同一根时间轴。
 * @param {string} name
 * @param {number} [rendererAt] 渲染端 performance.now()（相对导航）
 */
function rendererMark(name, rendererAt) {
  if (!ENABLED) return;
  const at = nowRel();
  stages.push({
    name: 'renderer:' + name,
    at: Math.round(at),
    durMs: Number.isFinite(rendererAt) ? Math.round(rendererAt) : null,
    source: 'renderer'
  });
}

/**
 * 生成报告对象。enabled=false 时返回 { enabled:false }，调用方无需分支。
 */
function snapshot() {
  if (!ENABLED) return { enabled: false };
  const byName = {};
  for (const s of stages) {
    if (!byName[s.name]) byName[s.name] = [];
    byName[s.name].push(s);
  }
  return {
    enabled: true,
    origin: 'process-start',
    totalMs: Math.round(nowRel()),
    stages: stages.slice(),
    marks: Object.fromEntries([...marks.entries()].map(([k, v]) => [k, Math.round(v)])),
    slowSyncOps: slowSyncOps.slice().sort((a, b) => b.durMs - a.durMs),
    byName
  };
}

/** 打印可读摘要到 stdout（由 MCU_STARTUP_PROFILE=1 时的手动调用触发）。 */
function printReport(label = '启动性能') {
  if (!ENABLED) return;
  const snap = snapshot();
  const line = '─'.repeat(60);
  console.log(`\n${line}\n  ${label}（主进程，相对进程启动）\n${line}`);
  for (const s of snap.stages) {
    const dur = s.durMs == null ? '     —' : String(s.durMs).padStart(6) + 'ms';
    console.log(`  ${String(s.at).padStart(7)}ms  ${dur}  ${s.name}`);
  }
  if (snap.slowSyncOps.length) {
    console.log(`\n  慢同步操作（≥${SLOW_OP_MS}ms，会阻塞 event loop）：`);
    for (const o of snap.slowSyncOps) {
      console.log(`    ${String(o.durMs).padStart(6)}ms  ${o.name}  (at ${o.at}ms)`);
    }
  }
  console.log('');
}

module.exports = { mark, span, spanAsync, rendererMark, snapshot, printReport, ENABLED };
