const https = require('https');
const fs = require('fs');
const { send } = require('../core/bus');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function downloadFile(url, dest, redirects = 0, onProgress = null) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) { reject(new Error('重定向次数过多')); return; }
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        resolve(downloadFile(res.headers.location, dest, redirects + 1, onProgress));
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        reject(new Error('HTTP ' + res.statusCode));
        return;
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      if (onProgress) {
        res.on('data', (chunk) => { received += chunk.length; onProgress(received, total); });
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    }).on('error', (e) => {
      try { fs.unlinkSync(dest); } catch {}
      reject(e);
    });
  });
}

async function downloadFileWithRetry(url, dest, onProgress, retries = 2) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await downloadFile(url, dest, 0, onProgress);
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        send(`[环境] 下载连接中断，准备重试 ${attempt + 1}/${retries} ...`, 'info');
        await wait(800 * (attempt + 1));
      }
    }
  }
  throw lastErr;
}

// 可选下载加速镜像：给 GitHub 链接加代理前缀
function applyMirror(url, cfg) {
  const m = ((cfg && cfg.ghProxy) || '').trim();
  if (!m) return url;
  return m.replace(/\/+$/, '') + '/' + url;
}

// 跟随重定向，探测最终地址 / 总大小 / 是否支持分段
function headInfo(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) { reject(new Error('重定向次数过多')); return; }
    const req = https.get(url, { headers: { Range: 'bytes=0-0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(headInfo(res.headers.location, redirects + 1));
        return;
      }
      res.resume();
      let size = 0;
      const cr = res.headers['content-range'];
      if (cr) { const m = cr.match(/\/(\d+)\s*$/); if (m) size = parseInt(m[1], 10); }
      const acceptRanges = res.statusCode === 206 || res.headers['accept-ranges'] === 'bytes';
      resolve({ finalUrl: url, size, acceptRanges });
    });
    req.on('error', reject);
  });
}

// 下载指定字节区间到分片文件
function downloadRange(url, start, end, dest, onChunk, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) { reject(new Error('重定向次数过多')); return; }
    const req = https.get(url, { headers: { Range: `bytes=${start}-${end}` } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(downloadRange(res.headers.location, start, end, dest, onChunk, redirects + 1));
        return;
      }
      if (res.statusCode !== 206 && res.statusCode !== 200) {
        res.resume(); reject(new Error('HTTP ' + res.statusCode)); return;
      }
      const file = fs.createWriteStream(dest);
      res.on('data', (c) => { if (onChunk) onChunk(c.length); });
      res.on('error', reject);
      file.on('error', reject);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    });
    req.on('error', reject);
  });
}

async function downloadRangeWithRetry(url, start, end, dest, onChunk, retries = 3) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) try { fs.unlinkSync(dest); } catch {}
      return await downloadRange(url, start, end, dest, onChunk);
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await wait(600 * (attempt + 1));
      }
    }
  }
  throw lastErr;
}

// 多连接分段下载（被限速时显著提速），不支持分段/小文件回退单连接
async function downloadFast(url, dest, onProgress, conns = 8) {
  let info = null;
  try { info = await headInfo(url); } catch {}
  if (!info || !info.acceptRanges || !info.size || info.size < 2 * 1024 * 1024) {
    return downloadFileWithRetry((info && info.finalUrl) || url, dest, onProgress);
  }
  const total = info.size;
  const n = Math.max(1, Math.min(conns, Math.ceil(total / (1024 * 1024))));
  const seg = Math.ceil(total / n);
  const parts = [];
  const tasks = [];
  let received = 0;
  for (let i = 0; i < n; i++) {
    const start = i * seg;
    if (start >= total) break;
    const end = Math.min(start + seg - 1, total - 1);
    const part = `${dest}.part${i}`;
    parts.push(part);
    tasks.push(downloadRangeWithRetry(info.finalUrl, start, end, part, (len) => {
      received += len; if (onProgress) onProgress(received, total);
    }));
  }
  try {
    await Promise.all(tasks);
  } catch (e) {
    for (const p of parts) { try { fs.unlinkSync(p); } catch {} }
    send('[环境] 分段下载中断，自动改用单连接重试 ...', 'info');
    return downloadFileWithRetry(info.finalUrl, dest, onProgress, 2);
  }
  const out = fs.createWriteStream(dest);
  for (const p of parts) {
    await new Promise((resolve, reject) => {
      const rs = fs.createReadStream(p);
      rs.on('error', reject);
      rs.on('end', resolve);
      rs.pipe(out, { end: false });
    });
  }
  await new Promise((resolve) => out.end(resolve));
  for (const p of parts) { try { fs.unlinkSync(p); } catch {} }
}

module.exports = {
  wait,
  downloadFile,
  downloadFileWithRetry,
  applyMirror,
  headInfo,
  downloadRange,
  downloadRangeWithRetry,
  downloadFast
};
