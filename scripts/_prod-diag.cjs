// 捕获生产构建的渲染层异常/控制台输出（用于定位打包后白屏）
const http = require('http');
const PORT = Number(process.env.MCU_DEBUG_PORT || 9223);
const getJson = (p) => new Promise((r, j) => http.get({ host: '127.0.0.1', port: PORT, path: p }, (s) => {
  let b = '';
  s.on('data', (c) => { b += c; });
  s.on('end', () => { try { r(JSON.parse(b)); } catch (e) { j(e); } });
}).on('error', j));

class C {
  constructor(u) {
    this.ws = new WebSocket(u); this.id = 0; this.p = new Map(); this.ev = [];
    this.ready = new Promise((r, j) => {
      const t = setTimeout(() => j(new Error('WebSocket 连接超时')), 6000);
      this.ws.onopen = () => { clearTimeout(t); r(); };
      this.ws.onerror = (e) => { clearTimeout(t); j(new Error('WebSocket 连接失败')); };
    });
    this.ws.onmessage = (e) => {
      const m = JSON.parse(typeof e.data === 'string' ? e.data : e.data.toString());
      if (m.id && this.p.has(m.id)) { const { r, j } = this.p.get(m.id); this.p.delete(m.id); m.error ? j(new Error(JSON.stringify(m.error))) : r(m.result); }
      else if (m.method) this.ev.push(m);
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((r, j) => {
      const t = setTimeout(() => { this.p.delete(id); j(new Error('CDP 超时: ' + method)); }, 6000);
      this.p.set(id, { r: (v) => { clearTimeout(t); r(v); }, j: (e) => { clearTimeout(t); j(e); } });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (e) { clearTimeout(t); j(e); }
    });
  }
  close() { try { this.ws.close(); } catch {} }
}
async function E(c, x) {
  const r = await c.send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: false, userGesture: true });
  if (r.exceptionDetails) return { error: (r.exceptionDetails.exception || {}).description };
  return { value: r.result && r.result.value };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const l = await getJson('/json/list');
  const pg = l.find((t) => t.type === 'page') || l[0];
  if (!pg) { console.error('无 page target'); process.exit(1); }
  console.log('target url:', pg.url);

  const c = new C(pg.webSocketDebuggerUrl);
  await c.ready;
  await c.send('Runtime.enable');
  await c.send('Log.enable');
  await c.send('Page.enable');
  // 重载以便抓到启动全过程
  await c.send('Page.reload', { ignoreCache: true });
  await sleep(6000);

  const exc = c.ev.filter((m) => m.method === 'Runtime.exceptionThrown');
  const cons = c.ev.filter((m) => m.method === 'Runtime.consoleAPICalled');
  const logE = c.ev.filter((m) => m.method === 'Log.entryAdded');
  const fail = c.ev.filter((m) => m.method === 'Network.loadingFailed');

  console.log('');
  console.log('══ 异常 (' + exc.length + ') ══');
  exc.slice(0, 6).forEach((m) => {
    const d = m.params.exceptionDetails;
    console.log('  !', ((d.exception || {}).description || d.text || '').split('\n').slice(0, 6).join('\n    '));
  });

  console.log('');
  console.log('══ 控制台 (' + cons.length + ') ══');
  cons.slice(0, 20).forEach((m) => {
    const t = (m.params.args || []).map((a) => (a.value !== undefined ? a.value : (a.description || a.type))).join(' ');
    console.log('  [' + m.params.type + ']', t.split('\n').slice(0, 4).join('\n      ').slice(0, 500));
  });

  console.log('');
  console.log('══ Log 条目 (' + logE.length + ') ══');
  logE.slice(0, 12).forEach((m) => {
    const e = m.params.entry;
    console.log('  [' + e.level + ']', (e.text || '').slice(0, 300), e.url ? '(' + e.url.slice(0, 120) + ')' : '');
  });

  console.log('');
  console.log('══ 资源加载失败 (' + fail.length + ') ══');
  fail.slice(0, 10).forEach((m) => console.log('  ✗', m.params.errorText, m.params.type));

  console.log('');
  console.log('══ 页面实际状态 ══');
  const st = await E(c, `JSON.stringify({
    appHtmlLen: (document.getElementById('app')||{}).innerHTML ? document.getElementById('app').innerHTML.length : -1,
    bodyText: (document.body.textContent||'').trim().slice(0,120),
    navCount: document.querySelectorAll('.nav-item').length,
    allNodes: document.querySelectorAll('*').length,
    hasApi: typeof window.api,
    scripts: Array.from(document.querySelectorAll('script[src]')).map(s=>s.getAttribute('src')),
    cssCount: document.querySelectorAll('link[rel=stylesheet]').length,
    readyState: document.readyState
  })`);
  console.log(st.value || st.error);
  c.close();
})().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
