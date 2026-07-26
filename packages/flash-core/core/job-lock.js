// 全局任务互斥：编译/烧录/生成 Makefile 等独占硬件与工具链的操作共用一把锁，
// 避免 UI 与 HTTP API、或重复点击导致双 make / 抢 SWD。
// 取消：kill 当前活动子进程；持锁函数应在子进程被杀后以失败结束并释放锁。

const bus = require('./bus');

let current = null; // { id, name, startedAt }

function getJobState() {
  if (!current) return { busy: false, job: null };
  return {
    busy: true,
    job: {
      id: current.id,
      name: current.name,
      startedAt: current.startedAt,
      elapsedMs: Date.now() - current.startedAt
    }
  };
}

function isBusy() {
  return !!current;
}

function newJobId() {
  return Date.now().toString(36) + '-' + Math.random().toString(16).slice(2, 8);
}

/**
 * 独占执行任务。若已有任务在跑则立即返回 busy，不排队。
 * @param {string} name 任务名（日志/状态用）
 * @param {(ctx:{id:string,name:string}) => Promise<any>} fn
 * @returns {Promise<{ok:boolean, result?:any, error?:string, busy?:boolean, job?:object}>}
 */
async function runExclusive(name, fn) {
  if (current) {
    return {
      ok: false,
      busy: true,
      error: '已有任务进行中: ' + current.name,
      job: getJobState().job
    };
  }
  const id = newJobId();
  current = { id, name: String(name || 'job'), startedAt: Date.now() };
  try {
    bus.send('[任务] 开始: ' + current.name, 'step');
    const result = await fn({ id, name: current.name });
    return { ok: true, result, job: { id, name: current.name } };
  } catch (err) {
    const msg = String((err && err.message) || err || 'unknown');
    bus.send('[任务] 异常: ' + current.name + ' — ' + msg, 'error');
    return { ok: false, error: msg, job: { id, name: current.name } };
  } finally {
    const finished = current;
    current = null;
    if (finished) {
      const ms = Date.now() - finished.startedAt;
      bus.send('[任务] 结束: ' + finished.name + ' (' + ms + 'ms)', 'info');
    }
  }
}

/**
 * 取消当前任务：杀掉活动子进程。持锁的 runExclusive 会在 spawn 失败/退出后结束。
 */
function cancelJob(reason) {
  if (!current) {
    return { ok: false, error: '当前没有可取消的任务', busy: false };
  }
  const job = { id: current.id, name: current.name, startedAt: current.startedAt };
  let killed = 0;
  try {
    const proc = require('../toolchain/proc');
    if (proc && typeof proc.killAllRunningProcesses === 'function') {
      const r = proc.killAllRunningProcesses(reason || 'user-cancel');
      killed = r && r.killed ? r.killed : 0;
    }
  } catch (e) {
    return { ok: false, error: String(e && e.message || e), job, busy: true };
  }
  bus.send('[任务] 已请求取消: ' + job.name + (killed ? '（结束 ' + killed + ' 个子进程）' : ''), 'warn');
  return { ok: true, killed, job, busy: true };
}

module.exports = {
  runExclusive,
  cancelJob,
  getJobState,
  isBusy
};
