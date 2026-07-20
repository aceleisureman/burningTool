// 本地 HTTP API：外部工具（IDE 插件、CI 脚本、快捷键工具等）通过
// POST /api/build-flash 触发当前选中项目的一键编译烧录。
//
// 设计要点：
//  - 仅监听 127.0.0.1，无鉴权（信任本机进程）
//  - 异步任务模型：POST 立刻返回 { taskId }，GET /api/task/:id 拉进度/日志
//  - 编译/烧录本身互斥，任务在内部队列里串行执行，避免并发抢 make / SWD
//  - 每个任务运行期间通过 bus.addExtraSink 旁路截取渲染端日志，作为任务日志留存

const http = require('http');
const path = require('path');
const bus = require('./bus');
const { loadConfig, addRecent } = require('./config');
const {
  compile,
  flash,
  detectBuildSystem,
  findKeilProject,
  findIocFile
} = require('../flash/flasher');
const fs = require('fs');

/* ── 任务表：id -> task ─────────────────────────────────
 * task = { id, mode, projectDir, status, buildOk, flashOk, error,
 *          log:[{t,text,type}], createdAt, startedAt, finishedAt }
 * status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
 */
const _tasks = new Map();
const _queue = [];
let _running = null;
let _idSeq = 0;
function newTaskId() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  _idSeq = (_idSeq + 1) & 0xffff;
  return `${stamp}-${_idSeq.toString(16).padStart(4, '0')}`;
}

function summarizeTask(t) {
  if (!t) return null;
  return {
    id: t.id,
    mode: t.mode,
    projectDir: t.projectDir,
    status: t.status,
    buildOk: t.buildOk,
    flashOk: t.flashOk,
    error: t.error || null,
    createdAt: t.createdAt,
    startedAt: t.startedAt || null,
    finishedAt: t.finishedAt || null,
    logLines: t.log.length
  };
}

function taskDetail(t) {
  if (!t) return null;
  return Object.assign(summarizeTask(t), { log: t.log });
}

function currentProject() {
  const cfg = loadConfig();
  const list = cfg.recentProjects || [];
  return list[0] || '';
}

function detectProject(dir) {
  if (!dir || !fs.existsSync(dir)) return { exists: false };
  const hasMakefile = fs.existsSync(path.join(dir, 'Makefile'));
  const keilProj = findKeilProject(dir);
  const iocFile = findIocFile(dir);
  return {
    exists: true,
    hasMakefile,
    hasKeil: !!keilProj,
    keilProject: keilProj ? path.relative(dir, keilProj) || path.basename(keilProj) : '',
    hasIoc: !!iocFile,
    iocFile: iocFile ? path.relative(dir, iocFile) || path.basename(iocFile) : '',
    buildSystem: detectBuildSystem(dir, loadConfig(), keilProj)
  };
}

/* ── 队列调度 ─────────────────────────────────────────── */
function enqueue(mode, projectDir) {
  const task = {
    id: newTaskId(),
    mode,
    projectDir,
    status: 'queued',
    buildOk: null,
    flashOk: null,
    error: null,
    log: [],
    createdAt: Date.now()
  };
  _tasks.set(task.id, task);
  _queue.push(task);
  // 简单容量控制：只留最近 50 条历史
  if (_tasks.size > 50) {
    const oldest = Array.from(_tasks.values())
      .filter((t) => t.status !== 'running' && t.status !== 'queued')
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const old of oldest.slice(0, _tasks.size - 50)) _tasks.delete(old.id);
  }
  drain();
  return task;
}

async function drain() {
  if (_running) return;
  const task = _queue.shift();
  if (!task) return;
  _running = task;
  task.status = 'running';
  task.startedAt = Date.now();

  const captureLog = (text, type) => {
    task.log.push({ t: Date.now(), text: String(text || ''), type: type || 'info' });
    // 单任务日志上限：防止长时间跑爆内存
    if (task.log.length > 5000) task.log.splice(0, task.log.length - 5000);
  };
  const off = bus.addExtraSink({
    send: (text, type) => captureLog(text, type),
    sendProgress: (key, text) => captureLog(text, 'progress')
  });

  try {
    captureLog(`[HTTP-API] ═════════ 任务 ${task.id} (${task.mode}) 开始 ═════════`, 'step');
    captureLog(`[HTTP-API] 项目: ${task.projectDir}`, 'info');
    const cfg = loadConfig();
    addRecent(task.projectDir);

    if (task.mode === 'build' || task.mode === 'build-flash') {
      task.buildOk = await compile(task.projectDir, cfg);
      if (!task.buildOk) {
        task.status = 'failed';
        task.error = 'compile failed';
        captureLog('[HTTP-API] ✗ 编译失败，跳过烧录', 'error');
      }
    }
    if (task.status !== 'failed' && (task.mode === 'flash' || task.mode === 'build-flash')) {
      task.flashOk = await flash(task.projectDir, loadConfig());
      if (!task.flashOk) {
        task.status = 'failed';
        task.error = task.error || 'flash failed';
      }
    }
    if (task.status !== 'failed') task.status = 'succeeded';
    captureLog(`[HTTP-API] ═════════ 任务 ${task.id} ${task.status} ═════════`, task.status === 'succeeded' ? 'success' : 'error');
  } catch (e) {
    task.status = 'failed';
    task.error = (e && e.message) || String(e);
    captureLog(`[HTTP-API] 异常: ${task.error}`, 'error');
  } finally {
    task.finishedAt = Date.now();
    off();
    _running = null;
    // 继续下一个
    setImmediate(drain);
  }
}

/* ── HTTP 请求处理 ────────────────────────────────────── */
function json(res, code, body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store'
  });
  res.end(payload);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('invalid json: ' + e.message)); }
    });
    req.on('error', reject);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname.replace(/\/+$/, '') || '/';

  // 只处理本机来源（回环网卡）—— 双保险
  if (req.socket && req.socket.remoteAddress && !/^(127\.|::1|::ffff:127\.)/.test(req.socket.remoteAddress)) {
    return json(res, 403, { ok: false, error: 'forbidden: local only' });
  }

  if (req.method === 'GET' && p === '/api/health') {
    return json(res, 200, { ok: true, service: 'mcu-toolbox', ts: Date.now() });
  }

  if (req.method === 'GET' && p === '/api/current') {
    const dir = currentProject();
    return json(res, 200, {
      ok: true,
      projectDir: dir,
      info: dir ? detectProject(dir) : null,
      recent: (loadConfig().recentProjects || []).slice(0, 12)
    });
  }

  if (req.method === 'GET' && p === '/api/tasks') {
    const list = Array.from(_tasks.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(summarizeTask);
    return json(res, 200, { ok: true, running: _running ? _running.id : null, tasks: list });
  }

  const m = p.match(/^\/api\/task\/([\w-]+)$/);
  if (req.method === 'GET' && m) {
    const t = _tasks.get(m[1]);
    if (!t) return json(res, 404, { ok: false, error: 'task not found' });
    // ?since=<index> 只返回该索引之后的日志（增量拉取）
    const since = parseInt(url.searchParams.get('since') || '0', 10) || 0;
    const detail = taskDetail(t);
    if (since > 0) detail.log = detail.log.slice(since);
    detail.since = since;
    detail.nextSince = t.log.length;
    return json(res, 200, { ok: true, task: detail });
  }

  if (req.method === 'POST' && (p === '/api/build-flash' || p === '/api/build' || p === '/api/flash')) {
    let body = {};
    try { body = await readBody(req); }
    catch (e) { return json(res, 400, { ok: false, error: e.message }); }
    const dir = (body && body.projectDir) || currentProject();
    if (!dir) return json(res, 400, { ok: false, error: 'no project selected: pass "projectDir" or select one in the UI first' });
    const info = detectProject(dir);
    if (!info.exists) return json(res, 400, { ok: false, error: 'project dir not found: ' + dir });
    if (!info.hasMakefile && !info.hasKeil) {
      return json(res, 400, { ok: false, error: 'project has no Makefile / Keil project (.uvprojx) in ' + dir });
    }
    const mode = p === '/api/build' ? 'build' : (p === '/api/flash' ? 'flash' : 'build-flash');
    const task = enqueue(mode, dir);
    return json(res, 202, { ok: true, taskId: task.id, mode, projectDir: dir, status: task.status });
  }

  return json(res, 404, { ok: false, error: 'unknown endpoint: ' + req.method + ' ' + p });
}

/* ── 生命周期 ─────────────────────────────────────────── */
let _server = null;
let _bound = null;

function start(opts = {}) {
  if (_server) return Promise.resolve(_bound);
  const host = opts.host || '127.0.0.1';
  const port = opts.port || 27080;
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      handle(req, res).catch((e) => {
        try { json(res, 500, { ok: false, error: (e && e.message) || String(e) }); } catch {}
      });
    });
    srv.on('error', (e) => { _server = null; reject(e); });
    srv.listen(port, host, () => {
      _server = srv;
      _bound = { host, port };
      resolve(_bound);
    });
  });
}

function stop() {
  return new Promise((resolve) => {
    if (!_server) return resolve();
    const s = _server; _server = null; _bound = null;
    s.close(() => resolve());
  });
}

function status() {
  return {
    running: !!_server,
    bind: _bound,
    queueLength: _queue.length,
    activeTaskId: _running ? _running.id : null
  };
}

module.exports = { start, stop, status };
