// MQTT 调试后端（mqtt.js）：连接 / 订阅 / 发布，支持多连接同时在线。
// 加载错误日志走 bus；状态/消息通道推送由 main.js 注入的 push(channel, payload) 完成。
const bus = require('../core/bus');

let _mqtt = null;
const mqttClients = new Map();   // id -> client（支持多连接同时在线）

function loadMqtt() {
  if (_mqtt !== null) return _mqtt;
  try { _mqtt = require('mqtt') || null; }
  catch (e) { _mqtt = false; bus.send('[MQTT] mqtt 模块加载失败: ' + e.message + '（请在工程目录执行 npm install mqtt）', 'error'); }
  return _mqtt;
}

function mqttCloseId(id) { const c = mqttClients.get(id); if (c) { try { c.removeAllListeners(); c.end(true); } catch (e) {} mqttClients.delete(id); } }

function registerMqtt(ipcMain, app, push) {
  const pushMqtt = typeof push === 'function' ? push : (() => {});
  app.on('before-quit', () => { for (const id of Array.from(mqttClients.keys())) mqttCloseId(id); });

  ipcMain.handle('mqtt-connect', async (_e, opts) => {
    const M = loadMqtt();
    if (!M) return { ok: false, error: 'mqtt 未安装（请在工程目录执行 npm install mqtt）' };
    opts = opts || {};
    const id = opts.id;
    if (!id) return { ok: false, error: '缺少连接 ID' };
    if (!opts.url) return { ok: false, error: '未指定 Broker 地址' };
    try {
      mqttCloseId(id);
      const o = {
        clientId: opts.clientId || ('mqttx_' + Math.random().toString(16).slice(2, 10)),
        username: opts.username || undefined,
        password: opts.password || undefined,
        keepalive: Number(opts.keepalive) || 60,
        clean: opts.clean !== false,
        connectTimeout: Number(opts.connectTimeout) || 8000,
        reconnectPeriod: opts.reconnect === false ? 0 : 4000,
        protocolVersion: Number(opts.protocolVersion) || 4
      };
      const client = M.connect(opts.url, o);
      mqttClients.set(id, client);
      client.on('connect', () => pushMqtt('mqtt-status', { id, state: 'connected' }));
      client.on('reconnect', () => pushMqtt('mqtt-status', { id, state: 'reconnecting' }));
      client.on('close', () => pushMqtt('mqtt-status', { id, state: 'closed' }));
      client.on('offline', () => pushMqtt('mqtt-status', { id, state: 'offline' }));
      client.on('error', (err) => pushMqtt('mqtt-status', { id, state: 'error', error: err && err.message ? err.message : String(err) }));
      client.on('message', (topic, payload, packet) => {
        pushMqtt('mqtt-message', {
          id,
          topic,
          payload: Array.from(payload || []),
          qos: packet ? packet.qos : 0,
          retain: packet ? !!packet.retain : false,
          ts: Date.now()
        });
      });
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('mqtt-disconnect', async (_e, opts) => {
    const id = opts && opts.id;
    mqttCloseId(id);
    pushMqtt('mqtt-status', { id, state: 'closed' });
    return { ok: true };
  });

  ipcMain.handle('mqtt-subscribe', async (_e, opts) => {
    opts = opts || {};
    const client = mqttClients.get(opts.id);
    if (!client) return { ok: false, error: 'MQTT 未连接' };
    if (!opts.topic) return { ok: false, error: '未指定主题' };
    return await new Promise((resolve) => {
      client.subscribe(opts.topic, { qos: Number(opts.qos) || 0 }, (err, granted) => {
        if (err) resolve({ ok: false, error: err.message });
        else resolve({ ok: true, granted: granted || [] });
      });
    });
  });

  ipcMain.handle('mqtt-unsubscribe', async (_e, opts) => {
    opts = opts || {};
    const client = mqttClients.get(opts.id);
    if (!client) return { ok: false, error: 'MQTT 未连接' };
    if (!opts.topic) return { ok: false, error: '未指定主题' };
    return await new Promise((resolve) => {
      client.unsubscribe(opts.topic, (err) => (err ? resolve({ ok: false, error: err.message }) : resolve({ ok: true })));
    });
  });

  ipcMain.handle('mqtt-publish', async (_e, opts) => {
    opts = opts || {};
    const client = mqttClients.get(opts.id);
    if (!client) return { ok: false, error: 'MQTT 未连接' };
    if (!opts.topic) return { ok: false, error: '未指定主题' };
    const buf = Buffer.from(opts.payload || []);
    return await new Promise((resolve) => {
      client.publish(opts.topic, buf, { qos: Number(opts.qos) || 0, retain: !!opts.retain }, (err) => (err ? resolve({ ok: false, error: err.message }) : resolve({ ok: true })));
    });
  });
}

module.exports = { registerMqtt };
