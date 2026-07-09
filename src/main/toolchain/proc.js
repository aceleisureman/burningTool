// 通用子进程执行：流式行输出（经 bus 发日志）与捕获输出两种模式。
// 各业务模块复用本文件，日志通过 bus 发往渲染端，不直接依赖 mainWindow。
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');
const bus = require('../core/bus');

/* ── 通用进程执行：按行流式输出 + 可选清洗器 + Promise(退出码) ── */
function runProcess(cmd, args, options = {}) {
  const { clean, capture, timeoutMs, ...spawnOpts } = options;
  return new Promise((resolve) => {
    const child = spawn(cmd, args, spawnOpts);
    let captured = '';
    let done = false;
    let timer = null;
    const emit = (line) => {
      if (capture) captured += line + '\n';
      if (clean) {
        const r = clean(line);
        if (r == null) return;             // 清洗器返回 null = 丢弃该行（噪声）
        if (typeof r === 'string') { if (r.trim()) bus.send(r); }
        else bus.send(r.text, r.type || 'info');
      } else {
        const t = line.trimEnd();
        if (t.trim()) bus.send(t);
      }
    };
    // 进度条用 \r 原地刷新，这里把 \r 也当换行切分，纯符号行交给清洗器丢弃
    const makeSink = () => {
      let buf = '';
      // 用 StringDecoder 累积解码，避免一个多字节 UTF-8 字符（如中文）正好跨在两个 chunk 边界被截断成乱码
      const decoder = new StringDecoder('utf8');
      return {
        push: (d) => {
          buf += decoder.write(d);
          const parts = buf.split(/[\r\n]+/);
          buf = parts.pop();               // 末段可能是半行，留到下次
          for (const p of parts) emit(p);
        },
        end: () => { buf += decoder.end(); if (buf) { emit(buf); buf = ''; } }
      };
    };
    const finish = (result) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    const killProcessTree = () => {
      try {
        if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
        else child.kill('SIGKILL');
      } catch {}
    };
    const so = makeSink(), se = makeSink();
    if (timeoutMs) {
      timer = setTimeout(() => {
        killProcessTree();
        so.end();
        se.end();
        finish(capture ? { code: -2, out: captured, timedOut: true } : -2);
      }, timeoutMs);
    }
    if (child.stdout) child.stdout.on('data', so.push);
    if (child.stderr) child.stderr.on('data', se.push);
    child.on('error', (err) => {
      bus.send(`[系统] 无法启动: ${cmd} (${err.message})`, 'error');
      finish(capture ? { code: -1, out: captured } : -1);
    });
    child.on('close', (code) => {
      if (done) return;
      so.end();
      se.end();
      finish(capture ? { code, out: captured } : code);
    });
  });
}

/* ── 通用进程执行：捕获输出 + Promise({code,out}) ──────── */
function runCapture(cmd, args, options = {}) {
  const { timeoutMs, ...spawnOpts } = options;
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const child = spawn(cmd, args, spawnOpts);
    // 同 runProcess：按字节流累积解码，防止中文等多字节字符跨 chunk 边界出现乱码
    const outDecoder = new StringDecoder('utf8');
    const errDecoder = new StringDecoder('utf8');
    let timer = null;
    const finish = (r) => { if (done) return; done = true; if (timer) clearTimeout(timer); resolve(r); };
    if (timeoutMs) {
      timer = setTimeout(() => {
        // 超时：杀掉进程树（Windows 用 taskkill /T 连子进程一起杀，释放调试探针）
        try {
          if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
          else child.kill('SIGKILL');
        } catch {}
        finish({ code: -2, out, timedOut: true });
      }, timeoutMs);
    }
    if (child.stdout) child.stdout.on('data', (d) => { out += outDecoder.write(d); });
    if (child.stderr) child.stderr.on('data', (d) => { out += errDecoder.write(d); });
    child.on('error', () => finish({ code: -1, out }));
    child.on('close', (code) => { out += outDecoder.end() + errDecoder.end(); finish({ code, out }); });
  });
}

module.exports = { runProcess, runCapture };
