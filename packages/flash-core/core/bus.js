// 渲染端日志/进度的输出汇聚点：各业务模块只 require 本文件即可发日志，
// 无需直接依赖 mainWindow。main.js 启动时用 setSinks 注入真正的实现。
let _send = () => {};
let _sendProgress = () => {};
let _sendDownloadProgress = () => {};
// 额外的监听者（HTTP 任务日志抓取等）：不替换主 sink，只旁路收听
const _extra = new Set();

function setSinks(sinks = {}) {
  if (typeof sinks.send === 'function') _send = sinks.send;
  if (typeof sinks.sendProgress === 'function') _sendProgress = sinks.sendProgress;
  if (typeof sinks.sendDownloadProgress === 'function') _sendDownloadProgress = sinks.sendDownloadProgress;
}

// 添加旁路 sink（可只实现其中一个方法），返回取消函数
function addExtraSink(sink) {
  if (!sink) return () => {};
  _extra.add(sink);
  return () => _extra.delete(sink);
}

function fanout(kind, args) {
  for (const s of _extra) {
    const fn = s && s[kind];
    if (typeof fn === 'function') { try { fn(...args); } catch {} }
  }
}

module.exports = {
  setSinks,
  addExtraSink,
  send: (...a) => { _send(...a); fanout('send', a); },
  sendProgress: (...a) => { _sendProgress(...a); fanout('sendProgress', a); },
  sendDownloadProgress: (...a) => { _sendDownloadProgress(...a); fanout('sendDownloadProgress', a); }
};
