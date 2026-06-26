// 渲染端日志/进度的输出汇聚点：各业务模块只 require 本文件即可发日志，
// 无需直接依赖 mainWindow。main.js 启动时用 setSinks 注入真正的实现。
let _send = () => {};
let _sendProgress = () => {};
let _sendDownloadProgress = () => {};

function setSinks(sinks = {}) {
  if (typeof sinks.send === 'function') _send = sinks.send;
  if (typeof sinks.sendProgress === 'function') _sendProgress = sinks.sendProgress;
  if (typeof sinks.sendDownloadProgress === 'function') _sendDownloadProgress = sinks.sendDownloadProgress;
}

module.exports = {
  setSinks,
  send: (...a) => _send(...a),
  sendProgress: (...a) => _sendProgress(...a),
  sendDownloadProgress: (...a) => _sendDownloadProgress(...a)
};
