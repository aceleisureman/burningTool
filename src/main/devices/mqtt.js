// MQTT 调试后端（mqtt.js）：连接 / 订阅 / 发布，支持多连接同时在线。
// 加载错误日志走 bus；状态/消息通道推送由 main.js 注入的 push(channel, payload) 完成。
const bus = require('../core/bus');

let _mqtt = null;
const mqttClients = new Map();   // id -> client（支持多连接同时在线）
const mqttSubscriptions = new Map();

const MAX_MQTT_CLIENTS = 32;
const MAX_MQTT_SUBSCRIPTIONS = 256;
const MAX_MQTT_ID_CHARS = 128;
const MAX_MQTT_URL_BYTES = 4096;
const MAX_MQTT_CREDENTIAL_BYTES = 4096;
const MAX_MQTT_TOPIC_BYTES = 4096;
const MAX_MQTT_PAYLOAD_BYTES = 256 * 1024;
const MAX_MQTT_QUEUE_BYTES = 4 * 1024 * 1024;
const MAX_MQTT_QUEUE_MESSAGES = 500;
const MQTT_PROTOCOLS = new Set(['mqtt:', 'mqtts:', 'tcp:', 'tls:', 'ssl:', 'ws:', 'wss:', 'wx:', 'wxs:', 'ali:', 'alis:', 'mqtt+unix:', 'unix:']);

function utf8Size(value) {
  return Buffer.byteLength(String(value), 'utf8');
}

function readConnectionId(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('缺少连接 ID');
  const id = value.trim();
  if (id.length > MAX_MQTT_ID_CHARS) throw new Error(`连接 ID 不能超过 ${MAX_MQTT_ID_CHARS} 个字符`);
  return id;
}

function readBoundedString(value, name, maxBytes, optional = true) {
  if (value == null || value === '') return optional ? undefined : '';
  if (typeof value !== 'string') throw new Error(`${name} 格式无效`);
  if (utf8Size(value) > maxBytes) throw new Error(`${name} 不能超过 ${maxBytes} 字节`);
  return value;
}

function readBrokerUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('未指定 Broker 地址');
  const url = value.trim();
  if (utf8Size(url) > MAX_MQTT_URL_BYTES) throw new Error(`Broker 地址不能超过 ${MAX_MQTT_URL_BYTES} 字节`);
  let parsed;
  try { parsed = new URL(url); }
  catch { throw new Error('Broker 地址格式无效'); }
  if (!MQTT_PROTOCOLS.has(parsed.protocol)) throw new Error('Broker 地址仅支持 mqtt/mqtts/tcp/tls/ssl/ws/wss 协议');
  return url;
}

function readInteger(value, fallback, min, max, name) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} 必须是 ${min}-${max} 的整数`);
  return n;
}

function readQos(value) {
  return readInteger(value, 0, 0, 2, 'QoS');
}

function readTopic(value, publish = false) {
  if (typeof value !== 'string' || !value.length) throw new Error('未指定主题');
  if (value.includes('\0')) throw new Error('主题不能包含空字符');
  if (utf8Size(value) > MAX_MQTT_TOPIC_BYTES) throw new Error(`主题不能超过 ${MAX_MQTT_TOPIC_BYTES} 字节`);
  if (publish && /[#+]/.test(value)) throw new Error('发布主题不能包含 + 或 # 通配符');
  return value;
}

function readPayload(value) {
  if (value == null) return Buffer.alloc(0);
  let size;
  if (Array.isArray(value)) size = value.length;
  else if (value instanceof ArrayBuffer) size = value.byteLength;
  else if (ArrayBuffer.isView(value)) size = value.byteLength;
  else throw new Error('消息载荷格式无效');
  if (size > MAX_MQTT_PAYLOAD_BYTES) throw new Error(`消息载荷不能超过 ${MAX_MQTT_PAYLOAD_BYTES} 字节`);
  if (Array.isArray(value)) {
    for (const byte of value) {
      if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw new Error('消息载荷包含无效字节');
    }
    return Buffer.from(value);
  }
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function truncateUtf8(value, maxBytes) {
  const text = String(value == null ? '' : value);
  const raw = Buffer.from(text, 'utf8');
  if (raw.length <= maxBytes) return { text, truncated: false };
  let end = maxBytes;
  while (end > 0 && (raw[end] & 0xC0) === 0x80) end--;
  return { text: raw.subarray(0, end).toString('utf8'), truncated: true };
}

function safeError(err) {
  return truncateUtf8(err && err.message ? err.message : String(err), 4096).text;
}

function loadMqtt() {
  if (_mqtt !== null) return _mqtt;
  try { _mqtt = require('mqtt') || null; }
  catch (e) { _mqtt = false; bus.send('[MQTT] mqtt 模块加载失败: ' + e.message + '（请在工程目录执行 npm install mqtt）', 'error'); }
  return _mqtt;
}

function mqttCloseId(id) {
  const c = mqttClients.get(id);
  if (c) {
    try { c.removeAllListeners(); c.end(true); } catch (e) {}
    mqttClients.delete(id);
  }
  mqttSubscriptions.delete(id);
}

function registerMqtt(ipcMain, app, push) {
  const pushMqtt = typeof push === 'function' ? push : (() => {});

  // 攒批推送：高频主题（传感器等）每条消息一次 IPC 会拖垮渲染端，
  // 合并 30ms 窗口内的消息成数组一次推送（'mqtt-message' 通道现在承载数组），
  // payload 直接传 Uint8Array 避免 Array.from 普通数组的结构化克隆开销。
  let msgQueue = [];
  let msgQueueBytes = 0;
  let msgTimer = null;
  const flushMessages = () => {
    if (msgTimer) { clearTimeout(msgTimer); msgTimer = null; }
    if (!msgQueue.length) return;
    const batch = msgQueue;
    msgQueue = [];
    msgQueueBytes = 0;
    pushMqtt('mqtt-message', batch);
  };
  const queueMessage = (m) => {
    const bytes = m && m.payload ? m.payload.byteLength || 0 : 0;
    if (msgQueue.length && msgQueueBytes + bytes > MAX_MQTT_QUEUE_BYTES) flushMessages();
    msgQueue.push(m);
    msgQueueBytes += bytes;
    if (msgQueue.length >= MAX_MQTT_QUEUE_MESSAGES || msgQueueBytes >= MAX_MQTT_QUEUE_BYTES) flushMessages();
    else if (!msgTimer) msgTimer = setTimeout(flushMessages, 30);
  };
  app.on('before-quit', () => {
    if (msgTimer) { clearTimeout(msgTimer); msgTimer = null; }
    msgQueue = [];
    msgQueueBytes = 0;
    for (const id of Array.from(mqttClients.keys())) mqttCloseId(id);
  });

  ipcMain.handle('mqtt-connect', async (_e, opts) => {
    const M = loadMqtt();
    if (!M) return { ok: false, error: 'mqtt 未安装（请在工程目录执行 npm install mqtt）' };
    opts = opts || {};
    try {
      const id = readConnectionId(opts.id);
      const url = readBrokerUrl(opts.url);
      if (!mqttClients.has(id) && mqttClients.size >= MAX_MQTT_CLIENTS) {
        return { ok: false, error: `最多同时创建 ${MAX_MQTT_CLIENTS} 个 MQTT 连接` };
      }
      const o = {
        clientId: readBoundedString(opts.clientId, 'Client ID', MAX_MQTT_CREDENTIAL_BYTES) || ('mqttx_' + Math.random().toString(16).slice(2, 10)),
        username: readBoundedString(opts.username, '用户名', MAX_MQTT_CREDENTIAL_BYTES),
        password: readBoundedString(opts.password, '密码', MAX_MQTT_CREDENTIAL_BYTES),
        keepalive: readInteger(opts.keepalive, 60, 0, 65535, 'Keepalive'),
        clean: opts.clean !== false,
        connectTimeout: readInteger(opts.connectTimeout, 8000, 100, 120000, '连接超时'),
        reconnectPeriod: opts.reconnect === false ? 0 : 4000,
        protocolVersion: readInteger(opts.protocolVersion, 4, 3, 5, '协议版本')
      };
      // 所有参数通过校验后再替换旧连接，避免一次无效编辑把仍可用的连接提前断开。
      mqttCloseId(id);
      const client = M.connect(url, o);
      mqttClients.set(id, client);
      mqttSubscriptions.set(id, new Set());
      client.on('connect', () => pushMqtt('mqtt-status', { id, state: 'connected' }));
      client.on('reconnect', () => pushMqtt('mqtt-status', { id, state: 'reconnecting' }));
      client.on('close', () => pushMqtt('mqtt-status', { id, state: 'closed' }));
      client.on('offline', () => pushMqtt('mqtt-status', { id, state: 'offline' }));
      client.on('error', (err) => pushMqtt('mqtt-status', { id, state: 'error', error: safeError(err) }));
      client.on('message', (topic, payload, packet) => {
        const source = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || []);
        const originalSize = source.length;
        const topicInfo = truncateUtf8(topic, MAX_MQTT_TOPIC_BYTES);
        queueMessage({
          id,
          topic: topicInfo.text,
          topicTruncated: topicInfo.truncated,
          payload: new Uint8Array(source.subarray(0, MAX_MQTT_PAYLOAD_BYTES)),
          truncated: originalSize > MAX_MQTT_PAYLOAD_BYTES,
          originalSize,
          qos: packet ? packet.qos : 0,
          retain: packet ? !!packet.retain : false,
          ts: Date.now()
        });
      });
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('mqtt-disconnect', async (_e, opts) => {
    try {
      const id = readConnectionId(opts && opts.id);
      mqttCloseId(id);
      pushMqtt('mqtt-status', { id, state: 'closed' });
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('mqtt-subscribe', async (_e, opts) => {
    opts = opts || {};
    try {
      const id = readConnectionId(opts.id);
      const client = mqttClients.get(id);
      if (!client) return { ok: false, error: 'MQTT 未连接' };
      const topic = readTopic(opts.topic);
      const qos = readQos(opts.qos);
      const subscriptions = mqttSubscriptions.get(id) || new Set();
      const isNew = !subscriptions.has(topic);
      if (isNew && subscriptions.size >= MAX_MQTT_SUBSCRIPTIONS) {
        return { ok: false, error: `每个连接最多订阅 ${MAX_MQTT_SUBSCRIPTIONS} 个主题` };
      }
      if (isNew) {
        subscriptions.add(topic);
        mqttSubscriptions.set(id, subscriptions);
      }
      return await new Promise((resolve) => {
        client.subscribe(topic, { qos }, (err, granted) => {
          if (err) {
            if (isNew) subscriptions.delete(topic);
            resolve({ ok: false, error: safeError(err) });
          }
          else {
            subscriptions.add(topic);
            resolve({ ok: true, granted: granted || [] });
          }
        });
      });
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('mqtt-unsubscribe', async (_e, opts) => {
    opts = opts || {};
    try {
      const id = readConnectionId(opts.id);
      const client = mqttClients.get(id);
      if (!client) return { ok: false, error: 'MQTT 未连接' };
      const topic = readTopic(opts.topic);
      return await new Promise((resolve) => {
        client.unsubscribe(topic, (err) => {
          if (err) resolve({ ok: false, error: safeError(err) });
          else {
            const subscriptions = mqttSubscriptions.get(id);
            if (subscriptions) subscriptions.delete(topic);
            resolve({ ok: true });
          }
        });
      });
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('mqtt-publish', async (_e, opts) => {
    opts = opts || {};
    try {
      const id = readConnectionId(opts.id);
      const client = mqttClients.get(id);
      if (!client) return { ok: false, error: 'MQTT 未连接' };
      const topic = readTopic(opts.topic, true);
      const qos = readQos(opts.qos);
      const buf = readPayload(opts.payload);
      return await new Promise((resolve) => {
        client.publish(topic, buf, { qos, retain: !!opts.retain }, (err) => (err ? resolve({ ok: false, error: safeError(err) }) : resolve({ ok: true })));
      });
    } catch (e) { return { ok: false, error: e.message }; }
  });
}

function closeAllMqtt() {
  for (const id of Array.from(mqttClients.keys())) mqttCloseId(id);
  return { ok: true, closed: true };
}

module.exports = { registerMqtt, closeAllMqtt };
