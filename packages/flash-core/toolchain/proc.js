// 通用子进程执行：流式行输出（经 bus 发日志）与捕获输出两种模式。
// 各业务模块复用本文件，日志通过 bus 发往渲染端，不直接依赖 mainWindow。
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');
const bus = require('../core/bus');

const DEFAULT_MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_LINE_CHARS = 64 * 1024;

function positiveLimit(value, fallback) {
  if (value == null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// 捕获输出只保留尾部。使用 Buffer 分段而不是反复裁剪大字符串，避免高输出量时产生大量复制。
function createTailCapture(maxBytes) {
  const limit = positiveLimit(maxBytes, DEFAULT_MAX_CAPTURE_BYTES);
  let chunks = [];
  let head = 0;
  let size = 0;
  let truncated = false;
  let pendingParts = [];
  let pendingBytes = 0;
  const TARGET_CHUNK_BYTES = 64 * 1024;

  const compact = () => {
    if (head > 1024 && head * 2 > chunks.length) {
      chunks = chunks.slice(head);
      head = 0;
    }
  };

  const appendBuffer = (chunk) => {
    if (!chunk.length) return;
    chunks.push(chunk);
    size += chunk.length;
    while (size > limit && head < chunks.length) {
      truncated = true;
      const first = chunks[head];
      const overflow = size - limit;
      if (first.length <= overflow) {
        size -= first.length;
        chunks[head++] = null;
      } else {
        chunks[head] = first.subarray(overflow);
        size -= overflow;
      }
    }
    compact();
  };

  const flushPending = () => {
    if (!pendingParts.length) return;
    appendBuffer(Buffer.from(pendingParts.join(''), 'utf8'));
    pendingParts = [];
    pendingBytes = 0;
  };

  return {
    append(value) {
      if (value == null || value === '') return;
      const text = String(value);
      const bytes = Buffer.byteLength(text, 'utf8');
      if (!bytes) return;
      if (bytes >= TARGET_CHUNK_BYTES) {
        flushPending();
        appendBuffer(Buffer.from(text, 'utf8'));
        return;
      }
      pendingParts.push(text);
      pendingBytes += bytes;
      if (pendingBytes >= TARGET_CHUNK_BYTES || pendingParts.length >= 256) flushPending();
    },
    isTruncated() { flushPending(); return truncated; },
    value() {
      flushPending();
      const live = chunks.slice(head);
      let out = live.length ? Buffer.concat(live, size) : Buffer.alloc(0);
      // 头部裁剪点可能落在 UTF-8 续字节中，跳到下一个字符边界，避免开头出现替换字符。
      let offset = 0;
      while (offset < out.length && (out[offset] & 0xC0) === 0x80) offset++;
      if (offset) out = out.subarray(offset);
      const text = out.toString('utf8');
      if (!truncated) return text;
      return `[系统] 输出过长，前部内容已截断；仅保留最后 ${limit} 字节。\n${text}`;
    }
  };
}

/* 活动子进程登记：更新安装 / 退出时统一清理，避免进程残留钉住安装器 */
const activeChildren = new Set();

function trackChild(child) {
  if (!child) return () => {};
  activeChildren.add(child);
  const untrack = () => { activeChildren.delete(child); };
  child.once('close', untrack);
  child.once('error', untrack);
  return untrack;
}

function killChildTree(child) {
  if (!child) return;
  try {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      child.kill('SIGKILL');
    }
  } catch {}
}

function killAllRunningProcesses(reason = '') {
  const list = Array.from(activeChildren);
  for (const child of list) killChildTree(child);
  activeChildren.clear();
  return { killed: list.length, reason: reason || '' };
}

function activeProcessCount() {
  return activeChildren.size;
}

/* ── 通用进程执行：按行流式输出 + 可选清洗器 + Promise(退出码) ── */
function runProcess(cmd, args, options = {}) {
  const { clean, capture, timeoutMs, maxCaptureBytes, maxLineChars, ...spawnOpts } = options;
  return new Promise((resolve) => {
    const child = spawn(cmd, args, spawnOpts);
    trackChild(child);
    const captured = createTailCapture(maxCaptureBytes);
    const lineLimit = positiveLimit(maxLineChars, DEFAULT_MAX_LINE_CHARS);
    let done = false;
    let timer = null;
    const emit = (line) => {
      if (capture) captured.append(line + '\n');
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
          if (done) return;
          buf += decoder.write(d);
          const parts = buf.split(/[\r\n]+/);
          buf = parts.pop();               // 末段可能是半行，留到下次
          for (const p of parts) emit(p);
          // 某些工具长时间不换行；分段发送，避免单行缓冲无限增长。
          while (buf.length > lineLimit) {
            emit(buf.slice(0, lineLimit));
            buf = buf.slice(lineLimit);
          }
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
      killChildTree(child);
    };
    const captureResult = (code, extra = {}) => ({
      code,
      out: captured.value(),
      truncated: captured.isTruncated(),
      ...extra
    });
    const so = makeSink(), se = makeSink();
    if (timeoutMs) {
      timer = setTimeout(() => {
        killProcessTree();
        so.end();
        se.end();
        finish(capture ? captureResult(-2, { timedOut: true }) : -2);
      }, timeoutMs);
    }
    if (child.stdout) child.stdout.on('data', so.push);
    if (child.stderr) child.stderr.on('data', se.push);
    child.on('error', (err) => {
      bus.send(`[系统] 无法启动: ${cmd} (${err.message})`, 'error');
      so.end();
      se.end();
      finish(capture ? captureResult(-1) : -1);
    });
    child.on('close', (code) => {
      if (done) return;
      so.end();
      se.end();
      finish(capture ? captureResult(code) : code);
    });
  });
}

/* ── 通用进程执行：捕获输出 + Promise({code,out}) ──────── */
function runCapture(cmd, args, options = {}) {
  const { timeoutMs, maxCaptureBytes, ...spawnOpts } = options;
  return new Promise((resolve) => {
    const captured = createTailCapture(maxCaptureBytes);
    let done = false;
    const child = spawn(cmd, args, spawnOpts);
    trackChild(child);
    // 同 runProcess：按字节流累积解码，防止中文等多字节字符跨 chunk 边界出现乱码
    const outDecoder = new StringDecoder('utf8');
    const errDecoder = new StringDecoder('utf8');
    let timer = null;
    const finish = (code, extra = {}) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      captured.append(outDecoder.end());
      captured.append(errDecoder.end());
      resolve({ code, out: captured.value(), truncated: captured.isTruncated(), ...extra });
    };
    if (timeoutMs) {
      timer = setTimeout(() => {
        // 超时：杀掉进程树（Windows 用 taskkill /T 连子进程一起杀，释放调试探针）
        killChildTree(child);
        finish(-2, { timedOut: true });
      }, timeoutMs);
    }
    if (child.stdout) child.stdout.on('data', (d) => { if (!done) captured.append(outDecoder.write(d)); });
    if (child.stderr) child.stderr.on('data', (d) => { if (!done) captured.append(errDecoder.write(d)); });
    child.on('error', () => finish(-1));
    child.on('close', (code) => finish(code));
  });
}

module.exports = { runProcess, runCapture, killAllRunningProcesses, activeProcessCount };
