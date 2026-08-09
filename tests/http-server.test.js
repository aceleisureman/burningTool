'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');

// http-server 间接依赖 config（需要 electron.app.getPath）、以及 flash/flasher（需要 electron）。
// 用 Module._load 拦截：electron 用一个临时目录 mock；flasher 里被 http-server 引用的
// compile/flash/detectBuildSystem/findKeilProject/findIocFile 直接替换成受控的假实现。
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'burningtool-http-'));
const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'burningtool-proj-'));
fs.writeFileSync(path.join(tmpProject, 'Makefile'), '# fake\n', 'utf8');

const fakeFlasher = {
  compile: async () => { await new Promise((r) => setTimeout(r, 20)); return true; },
  flash: async () => { await new Promise((r) => setTimeout(r, 20)); return true; },
  detectBuildSystem: () => 'make',
  findKeilProject: () => null,
  findIocFile: () => null
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { app: { getPath: () => tmpUserData } };
  // 相对路径匹配子模块 require('../flash/flasher')
  if (request && request.endsWith('flash/flasher')) return fakeFlasher;
  return origLoad.apply(this, arguments);
};

// 预置一个 config.json，把最近项目指向假工程
const cfgPath = path.join(tmpUserData, 'config.json');
fs.writeFileSync(cfgPath, JSON.stringify({ recentProjects: [tmpProject] }), 'utf8');

const httpApi = require('../src/main/core/http-server');
const jobLock = require('../src/main/core/job-lock');

function fetchJson(port, method, urlPath, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const req = http.request({
      host: '127.0.0.1', port, method, path: urlPath,
      headers: Object.assign(
        data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {},
        extraHeaders || {}
      )
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const txt = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: res.statusCode, body: JSON.parse(txt) }); }
        catch (e) { reject(new Error('non-json response: ' + txt)); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function waitTaskDone(port, id, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetchJson(port, 'GET', `/api/task/${id}`);
    const st = r.body.task && r.body.task.status;
    if (st === 'succeeded' || st === 'failed' || st === 'cancelled') return r.body.task;
    await new Promise((res) => setTimeout(res, 30));
  }
  throw new Error('task did not finish before timeout');
}

let PORT;

test('start rejects non-loopback bind hosts', async () => {
  await assert.rejects(
    httpApi.start({ host: '0.0.0.0', port: 0 }),
    /仅允许监听本机回环地址/
  );
});

test('start binds to 127.0.0.1 on requested port', async () => {
  const bound = await httpApi.start({ host: '127.0.0.1', port: 0 });
  assert.strictEqual(bound.host, '127.0.0.1');
  assert.ok(bound.port > 0);
  PORT = bound.port;
  const st = httpApi.status();
  assert.strictEqual(st.running, true);
  assert.strictEqual(st.bind.port, PORT);
});

test('GET /api/health returns ok', async () => {
  const r = await fetchJson(PORT, 'GET', '/api/health');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.ok, true);
  assert.strictEqual(r.body.service, 'mcu-toolbox');
});

test('cross-site browser requests are rejected', async () => {
  const r = await fetchJson(PORT, 'POST', '/api/build-flash', null, {
    Origin: 'https://example.com',
    'Sec-Fetch-Site': 'cross-site'
  });
  assert.strictEqual(r.status, 403);
  assert.match(r.body.error, /cross-site/);
});

test('GET /api/current shows the recent-most project', async () => {
  const r = await fetchJson(PORT, 'GET', '/api/current');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.ok, true);
  assert.strictEqual(r.body.projectDir, tmpProject);
  assert.strictEqual(r.body.info.hasMakefile, true);
});

test('POST /api/build-flash without body runs against current project', async () => {
  const r = await fetchJson(PORT, 'POST', '/api/build-flash');
  assert.strictEqual(r.status, 202);
  assert.strictEqual(r.body.ok, true);
  assert.strictEqual(r.body.projectDir, tmpProject);
  assert.ok(r.body.taskId);
  const task = await waitTaskDone(PORT, r.body.taskId);
  assert.strictEqual(task.status, 'succeeded');
  assert.strictEqual(task.buildOk, true);
  assert.strictEqual(task.flashOk, true);
});

test('POST /api/build runs only compile', async () => {
  const r = await fetchJson(PORT, 'POST', '/api/build');
  assert.strictEqual(r.status, 202);
  const task = await waitTaskDone(PORT, r.body.taskId);
  assert.strictEqual(task.status, 'succeeded');
  assert.strictEqual(task.buildOk, true);
  assert.strictEqual(task.flashOk, null);
});

test('HTTP tasks wait for the shared global job lock', async () => {
  let releaseBlocker;
  let notifyAcquired;
  const acquired = new Promise((resolve) => { notifyAcquired = resolve; });
  const blocker = jobLock.runExclusive('desktop-build', async () => {
    notifyAcquired();
    await new Promise((resolve) => { releaseBlocker = resolve; });
    return true;
  });
  await acquired;

  const r = await fetchJson(PORT, 'POST', '/api/build');
  assert.strictEqual(r.status, 202);
  const queued = await fetchJson(PORT, 'GET', `/api/task/${r.body.taskId}`);
  assert.strictEqual(queued.body.task.status, 'queued');

  releaseBlocker();
  await blocker;
  const task = await waitTaskDone(PORT, r.body.taskId);
  assert.strictEqual(task.status, 'succeeded');
});

test('POST /api/build-flash with unknown projectDir returns 400', async () => {
  const bogus = path.join(tmpProject, '__nope__');
  const r = await fetchJson(PORT, 'POST', '/api/build-flash', { projectDir: bogus });
  assert.strictEqual(r.status, 400);
  assert.match(r.body.error, /not found/);
});

test('GET /api/task/:id returns 404 for unknown id', async () => {
  const r = await fetchJson(PORT, 'GET', '/api/task/no-such-thing');
  assert.strictEqual(r.status, 404);
});

test('GET /api/tasks lists recent tasks', async () => {
  const r = await fetchJson(PORT, 'GET', '/api/tasks');
  assert.strictEqual(r.status, 200);
  assert.ok(Array.isArray(r.body.tasks));
  assert.ok(r.body.tasks.length >= 2);
});

test('unknown route returns 404', async () => {
  const r = await fetchJson(PORT, 'GET', '/nope');
  assert.strictEqual(r.status, 404);
});

test('stop() closes the server', async () => {
  await httpApi.stop();
  assert.strictEqual(httpApi.status().running, false);
});

test.after(() => {
  Module._load = origLoad;
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(tmpProject, { recursive: true, force: true }); } catch {}
});
