'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDownloadUrl } = require('../src/main/toolchain/downloader');

test('normalizeDownloadUrl accepts HTTPS and resolves relative redirects', () => {
  assert.equal(
    normalizeDownloadUrl('asset.zip', 'https://example.com/releases/v1/'),
    'https://example.com/releases/v1/asset.zip'
  );
});

test('normalizeDownloadUrl rejects insecure HTTP downloads', () => {
  assert.throws(
    () => normalizeDownloadUrl('http://example.com/toolchain.zip'),
    /必须使用 HTTPS/
  );
});

test('normalizeDownloadUrl rejects embedded credentials', () => {
  assert.throws(
    () => normalizeDownloadUrl('https://user:pass@example.com/toolchain.zip'),
    /不允许包含用户名或密码/
  );
});
