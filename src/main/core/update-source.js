'use strict';

const path = require('path');

const OWNER = 'aceleisureman';
const REPO = 'burningTool';
const OFFICIAL_LATEST_DOWNLOAD_URL = `https://github.com/${OWNER}/${REPO}/releases/latest/download/`;

function parseSecureUpdateUrl(value, label) {
  const name = label || '更新地址';
  const text = String(value || '').trim();
  if (!text) throw new Error(name + '不能为空');

  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(name + '不是有效的 URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(name + '必须使用 HTTPS');
  }
  if (parsed.username || parsed.password) {
    throw new Error(name + '不能包含用户名或密码');
  }
  parsed.hash = '';
  return parsed;
}

function normalizeUpdateFeedUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const parsed = parseSecureUpdateUrl(text, '应用更新镜像地址');
  if (!parsed.pathname.endsWith('/')) parsed.pathname += '/';
  return parsed.toString();
}

function officialUpdateSource(opts) {
  return {
    kind: opts && opts.fallback ? 'github-fallback' : 'github',
    provider: 'github',
    label: opts && opts.fallback ? 'GitHub 官方源（镜像回退）' : 'GitHub 官方源',
    feedUrl: OFFICIAL_LATEST_DOWNLOAD_URL
  };
}

function resolveConfiguredUpdateSource(config) {
  const feedUrl = normalizeUpdateFeedUrl(config && config.updateFeedUrl);
  if (!feedUrl) return officialUpdateSource();
  return {
    kind: 'mirror',
    provider: 'generic',
    label: '自定义更新镜像',
    feedUrl
  };
}

function resolveSecureUpdateUrl(baseUrl, reference, label) {
  const base = parseSecureUpdateUrl(baseUrl, '更新源地址');
  const value = String(reference || '').trim();
  if (!value) throw new Error((label || '更新文件地址') + '不能为空');

  let resolved;
  try {
    resolved = new URL(value, base);
  } catch {
    throw new Error((label || '更新文件地址') + '不是有效的 URL');
  }
  return parseSecureUpdateUrl(resolved.toString(), label || '更新文件地址').toString();
}

function getArtifactFileName(reference) {
  const value = String(reference || '').trim();
  if (!value) throw new Error('更新文件名不能为空');

  let parsed;
  try {
    parsed = new URL(value, 'https://updates.invalid/');
  } catch {
    throw new Error('更新文件名不是有效的 URL 或相对路径');
  }

  let name = path.posix.basename(parsed.pathname);
  try { name = decodeURIComponent(name); } catch {}
  if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name)) {
    throw new Error('更新文件名不安全');
  }
  return name;
}

function officialReleaseAssetUrl(version, reference) {
  const normalizedVersion = String(version || '').trim().replace(/^v/i, '');
  if (!normalizedVersion) throw new Error('更新版本号不能为空');
  const tag = encodeURIComponent('v' + normalizedVersion);
  const fileName = encodeURIComponent(getArtifactFileName(reference));
  return `https://github.com/${OWNER}/${REPO}/releases/download/${tag}/${fileName}`;
}

module.exports = {
  OWNER,
  REPO,
  OFFICIAL_LATEST_DOWNLOAD_URL,
  normalizeUpdateFeedUrl,
  officialUpdateSource,
  resolveConfiguredUpdateSource,
  resolveSecureUpdateUrl,
  getArtifactFileName,
  officialReleaseAssetUrl
};
