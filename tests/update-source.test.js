'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeUpdateFeedUrl,
  resolveConfiguredUpdateSource,
  resolveSecureUpdateUrl,
  getArtifactFileName,
  officialReleaseAssetUrl
} = require('../src/main/core/update-source');

test('应用更新镜像地址会规范化为 HTTPS 目录 URL', () => {
  assert.equal(normalizeUpdateFeedUrl(''), '');
  assert.equal(
    normalizeUpdateFeedUrl(' https://cdn.example.com/burningTool '),
    'https://cdn.example.com/burningTool/'
  );
  assert.throws(() => normalizeUpdateFeedUrl('http://cdn.example.com/app'), /必须使用 HTTPS/);
  assert.throws(() => normalizeUpdateFeedUrl('https://user:pass@cdn.example.com/app'), /不能包含用户名或密码/);
});

test('更新源配置在空值时使用 GitHub，非空时使用 Generic 镜像', () => {
  const official = resolveConfiguredUpdateSource({ updateFeedUrl: '' });
  assert.equal(official.provider, 'github');
  assert.equal(official.kind, 'github');

  const mirror = resolveConfiguredUpdateSource({ updateFeedUrl: 'https://cdn.example.com/releases' });
  assert.equal(mirror.provider, 'generic');
  assert.equal(mirror.kind, 'mirror');
  assert.equal(mirror.feedUrl, 'https://cdn.example.com/releases/');
});

test('更新文件 URL 支持相对路径并拒绝 HTTPS 降级', () => {
  assert.equal(
    resolveSecureUpdateUrl('https://cdn.example.com/releases/', 'latest.yml'),
    'https://cdn.example.com/releases/latest.yml'
  );
  assert.throws(
    () => resolveSecureUpdateUrl('https://cdn.example.com/releases/', 'http://cdn.example.com/latest.yml'),
    /必须使用 HTTPS/
  );
});

test('macOS 更新包只使用安全文件名并可生成官方回退地址', () => {
  assert.equal(getArtifactFileName('../packages/MCU 工具箱.zip?download=1'), 'MCU 工具箱.zip');
  assert.equal(
    officialReleaseAssetUrl('1.2.3', '../packages/MCU 工具箱.zip'),
    'https://github.com/aceleisureman/burningTool/releases/download/v1.2.3/' + encodeURIComponent('MCU 工具箱.zip')
  );
});
