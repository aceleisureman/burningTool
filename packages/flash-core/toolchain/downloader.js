const https = require('https');
const fs = require('fs');
const { send } = require('../core/bus');

function safeUnlink(filePath) {
  try { fs.unlinkSync(filePath); } catch {}
}

function destroyWritable(stream, filePath, done) {
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    safeUnlink(filePath);
    done();
  };
  if (!stream || stream.closed) { finish(); return; }
  stream.once('close', finish);
  try { stream.destroy(); }
  catch { finish(); }
}

function normalizeDownloadUrl(value, baseUrl) {
  let parsed;
  try { parsed = new URL(String(value || ''), baseUrl || undefined); }
  catch { throw new Error('无效下载地址: ' + value); }
  if (parsed.protocol !== 'https:') {
    throw new Error('下载地址必须使用 HTTPS: ' + parsed.toString());
  }
  if (parsed.username || parsed.password) {
    throw new Error('下载地址不允许包含用户名或密码');
  }
  return parsed.toString();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function downloadFile(url, dest, redirects = 0, onProgress = null) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) { reject(new Error('重定向次数过多')); return; }
    let requestUrl;
    try { requestUrl = normalizeDownloadUrl(url); }
    catch (e) { reject(e); return; }
    const tmp = dest + '.part';
    if (redirects === 0) safeUnlink(tmp);
    let settled = false;
    let response = null;
    let file = null;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      try { if (response && file) response.unpipe(file); } catch {}
      try { if (response && !response.destroyed) response.destroy(); } catch {}
      destroyWritable(file, tmp, () => reject(err));
    };
    const req = https.get(requestUrl, (res) => {
      response = res;
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        settled = true;
        res.resume();
        let next;
        try { next = normalizeDownloadUrl(res.headers.location, requestUrl); }
        catch (e) { reject(e); return; }
        resolve(downloadFile(next, dest, redirects + 1, onProgress));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        fail(new Error('HTTP ' + res.statusCode));
        return;
      }
      const parsedTotal = parseInt(res.headers['content-length'] || '0', 10);
      const total = Number.isFinite(parsedTotal) && parsedTotal > 0 ? parsedTotal : 0;
      let received = 0;
      file = fs.createWriteStream(tmp);
      res.on('data', (chunk) => {
        received += chunk.length;
        if (onProgress) onProgress(received, total);
      });
      res.on('aborted', () => fail(new Error('下载响应中断')));
      res.on('error', fail);
      file.on('error', fail);
      res.pipe(file);
      file.on('finish', () => file.close(() => {
        if (settled) return;
        if (total > 0 && received !== total) {
          fail(new Error(`下载长度不匹配: ${received}/${total}`));
          return;
        }
        try {
          safeUnlink(dest);
          fs.renameSync(tmp, dest);
          settled = true;
          resolve({ path: dest, size: received });
        } catch (e) {
          fail(e);
        }
      }));
    });
    req.on('error', fail);
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
    let requestUrl;
    try { requestUrl = normalizeDownloadUrl(url); }
    catch (e) { reject(e); return; }
    const req = https.get(requestUrl, { headers: { Range: 'bytes=0-0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        let next;
        try { next = normalizeDownloadUrl(res.headers.location, requestUrl); }
        catch (e) { reject(e); return; }
        resolve(headInfo(next, redirects + 1));
        return;
      }
      res.resume();
      let size = 0;
      const cr = res.headers['content-range'];
      if (cr) { const m = cr.match(/\/(\d+)\s*$/); if (m) size = parseInt(m[1], 10); }
      const acceptRanges = res.statusCode === 206 || res.headers['accept-ranges'] === 'bytes';
      resolve({ finalUrl: requestUrl, size, acceptRanges });
    });
    req.on('error', reject);
  });
}

// 下载指定字节区间到分片文件
function downloadRange(url, start, end, dest, onChunk, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) { reject(new Error('重定向次数过多')); return; }
    let requestUrl;
    try { requestUrl = normalizeDownloadUrl(url); }
    catch (e) { reject(e); return; }
    let settled = false;
    let response = null;
    let file = null;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      try { if (response && file) response.unpipe(file); } catch {}
      try { if (response && !response.destroyed) response.destroy(); } catch {}
      destroyWritable(file, dest, () => reject(err));
    };
    const req = https.get(requestUrl, { headers: { Range: `bytes=${start}-${end}` } }, (res) => {
      response = res;
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        settled = true;
        res.resume();
        let next;
        try { next = normalizeDownloadUrl(res.headers.location, requestUrl); }
        catch (e) { reject(e); return; }
        resolve(downloadRange(next, start, end, dest, onChunk, redirects + 1));
        return;
      }
      if (res.statusCode !== 206) {
        res.resume(); fail(new Error('HTTP ' + res.statusCode)); return;
      }
      const expected = end - start + 1;
      const range = String(res.headers['content-range'] || '').match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
      if (!range || Number(range[1]) !== start || Number(range[2]) !== end) {
        res.resume(); fail(new Error('分段响应范围不匹配')); return;
      }
      safeUnlink(dest);
      file = fs.createWriteStream(dest);
      let received = 0;
      res.on('data', (c) => { received += c.length; if (onChunk) onChunk(c.length); });
      res.on('aborted', () => fail(new Error('分段响应中断')));
      res.on('error', fail);
      file.on('error', fail);
      res.pipe(file);
      file.on('finish', () => file.close(() => {
        if (settled) return;
        if (received !== expected) {
          fail(new Error(`分段长度不匹配: ${received}/${expected}`));
          return;
        }
        settled = true;
        resolve();
      }));
    });
    req.on('error', fail);
  });
}

async function downloadRangeWithRetry(url, start, end, dest, onChunk, retries = 3) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      try { fs.unlinkSync(dest); } catch {}
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
  const results = await Promise.allSettled(tasks);
  if (results.some((result) => result.status === 'rejected')) {
    for (const p of parts) { try { fs.unlinkSync(p); } catch {} }
    send('[环境] 分段下载中断，自动改用单连接重试 ...', 'info');
    return downloadFileWithRetry(info.finalUrl, dest, onProgress, 2);
  }
  const assembled = dest + '.assembling';
  safeUnlink(assembled);
  const out = fs.createWriteStream(assembled);
  try {
    for (const p of parts) {
      await new Promise((resolve, reject) => {
        const rs = fs.createReadStream(p);
        const onOutError = (e) => { rs.destroy(); reject(e); };
        out.once('error', onOutError);
        rs.on('error', (e) => { out.removeListener('error', onOutError); reject(e); });
        rs.on('end', () => { out.removeListener('error', onOutError); resolve(); });
        rs.pipe(out, { end: false });
      });
    }
    await new Promise((resolve, reject) => {
      out.once('error', reject);
      out.end(resolve);
    });
    const assembledSize = fs.statSync(assembled).size;
    if (assembledSize !== total) throw new Error(`分段合并长度不匹配: ${assembledSize}/${total}`);
    safeUnlink(dest);
    fs.renameSync(assembled, dest);
  } catch (e) {
    await new Promise((resolve) => destroyWritable(out, assembled, resolve));
    throw e;
  } finally {
    for (const p of parts) safeUnlink(p);
  }
}

module.exports = {
  wait,
  downloadFile,
  downloadFileWithRetry,
  applyMirror,
  headInfo,
  downloadRange,
  downloadRangeWithRetry,
  downloadFast,
  normalizeDownloadUrl
};
