'use strict';

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

/** 将 {0} {1} 占位符替换为实参 */
function fmt(template, ...args) {
  return template.replace(/\{(\d+)\}/g, (_, i) => (args[i] == null ? '' : String(args[i])));
}

/** 加载指定 locale 的 JSON 文件，失败时返回 {} */
function loadBundle(locale) {
  const dir = path.join(__dirname, '..', 'i18n');
  const file = path.join(dir, `${locale}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** 解析 VS Code 当前显示语言，返回 'zh-cn' 或 'en' */
function resolveLocale() {
  const lang = (vscode.env.language || 'en').toLowerCase();
  if (lang === 'zh-cn' || lang === 'zh-hans' || lang.startsWith('zh-hans-')) return 'zh-cn';
  if (lang === 'zh-tw' || lang === 'zh-hant' || lang.startsWith('zh-hant-')) return 'zh-cn'; // 繁体暂用简体
  return 'en';
}

let _locale = null;
let _bundle = null;
let _fallback = null;

function init() {
  _locale = resolveLocale();
  _bundle = loadBundle(_locale) || {};
  if (_locale !== 'en') {
    _fallback = loadBundle('en') || {};
  } else {
    _fallback = {};
  }
}

/**
 * 翻译一个 key，支持 {0}{1} 占位符替换。
 * @param {string} key
 * @param {...any} args
 * @returns {string}
 */
function t(key, ...args) {
  if (!_bundle) init();
  const template = _bundle[key] || _fallback[key] || key;
  return args.length ? fmt(template, ...args) : template;
}

/** 当前语言代码（'zh-cn' | 'en'） */
function locale() {
  if (!_locale) init();
  return _locale;
}

module.exports = { t, locale, init };
