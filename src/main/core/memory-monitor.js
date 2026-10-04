'use strict';
// 内存监控：采集主进程 / 渲染进程 / GPU 的工作集、峰值、私有字节与 JS 堆用量。
// 供「设置 → 内存监控」实时采样、导出日志，用于排查内存增长与验证优化效果。
//
// 设计要点：
//   · electron 懒加载 —— 让本模块在纯 Node 环境（单元测试）下也能被 require 而不崩，
//     只是 collect() 返回 { ok:false }。测试因此可以断言「永不抛异常」。
//   · 不改启动参数：GC 仅在用户点击时惰性尝试暴露（v8.setFlagsFromString），失败则如实回报。

const MB = 1024 * 1024;

// Electron 进程类型 → 中文标签
const TYPE_LABEL = {
  Browser: '主进程',
  Tab: '渲染进程',
  GPU: 'GPU 进程',
  Utility: '辅助进程',
  Zygote: 'Zygote',
  SandboxHelper: '沙箱辅助',
  PepperPlugin: '插件进程',
  NetworkService: '网络服务'
};

function getApp() {
  try {
    const electron = require('electron');
    return (electron && electron.app) || null;
  } catch (_e) {
    return null;
  }
}

function toMb(bytes) {
  return Math.round(((Number(bytes) || 0) / MB) * 10) / 10;
}
function kbToMb(kb) {
  return Math.round(((Number(kb) || 0) / 1024) * 10) / 10;
}
function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

let gcAttempted = false;

// 惰性启用 V8 GC：不污染启动参数，只在用户点「触发 GC」时试一次。
function ensureGc() {
  if (typeof global.gc === 'function') return true;
  if (gcAttempted) return false;
  gcAttempted = true;
  try {
    require('v8').setFlagsFromString('--expose_gc');
  } catch (_e) { /* 忽略：某些环境不允许运行时改 flag */ }
  return typeof global.gc === 'function';
}

// 采集一次快照。永不抛异常：任何失败都以 { ok:false, error } 返回。
function collect() {
  const at = Date.now();
  const app = getApp();
  if (!app || typeof app.getAppMetrics !== 'function') {
    return { ok: false, error: 'electron-unavailable', at };
  }

  const processes = [];
  let totalWorkingSetMb = 0;
  let totalPrivateMb = 0;
  let mainWorkingSetMb = 0;
  let rendererWorkingSetMb = 0;
  let gpuWorkingSetMb = 0;

  try {
    for (const m of app.getAppMetrics()) {
      const mem = m.memory || {};
      const workingSetMb = kbToMb(mem.workingSetSize);
      const privateMb = kbToMb(mem.privateBytes);
      processes.push({
        pid: m.pid,
        type: m.type || 'Unknown',
        label: TYPE_LABEL[m.type] || m.type || '未知',
        workingSetMb,
        peakWorkingSetMb: kbToMb(mem.peakWorkingSetSize),
        privateMb,
        cpuPercent: m.cpu ? round1(m.cpu.percentCPUUsage) : 0
      });
      totalWorkingSetMb += workingSetMb;
      totalPrivateMb += privateMb;
      if (m.type === 'Tab') rendererWorkingSetMb += workingSetMb;
      else if (m.type === 'Browser') mainWorkingSetMb += workingSetMb;
      else if (m.type === 'GPU') gpuWorkingSetMb += workingSetMb;
    }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), at };
  }

  // 主进程 JS 堆：与「工作集」是两回事 —— 堆涨得快通常意味着 JS 层泄漏
  let mainHeapUsedMb = 0;
  let mainHeapTotalMb = 0;
  let mainRssMb = 0;
  try {
    const mu = process.memoryUsage();
    mainHeapUsedMb = toMb(mu.heapUsed);
    mainHeapTotalMb = toMb(mu.heapTotal);
    mainRssMb = toMb(mu.rss);
  } catch (_e) { /* 忽略 */ }

  let mainUptimeSec = 0;
  try { mainUptimeSec = Math.round(process.uptime()); } catch (_e) { /* 忽略 */ }

  // 进程按工作集降序，便于直接看出谁最占内存
  processes.sort((a, b) => b.workingSetMb - a.workingSetMb);

  return {
    ok: true,
    at,
    processCount: processes.length,
    totalWorkingSetMb: round1(totalWorkingSetMb),
    totalPrivateMb: round1(totalPrivateMb),
    mainWorkingSetMb: round1(mainWorkingSetMb),
    rendererWorkingSetMb: round1(rendererWorkingSetMb),
    gpuWorkingSetMb: round1(gpuWorkingSetMb),
    mainHeapUsedMb,
    mainHeapTotalMb,
    mainRssMb,
    mainUptimeSec,
    processes
  };
}

// 触发主进程 GC（渲染进程的 GC 由渲染层自行处理）。永不抛异常。
function forceGc() {
  if (!ensureGc()) {
    return {
      ok: false,
      note: 'gc-unavailable',
      hint: '当前 V8 未暴露 gc()；可用 MCU_EXPOSE_GC=1 启动应用以启用'
    };
  }
  try {
    global.gc();
    return { ok: true, note: 'gc-done' };
  } catch (e) {
    return { ok: false, note: String((e && e.message) || e) };
  }
}

module.exports = { collect, forceGc, TYPE_LABEL };
