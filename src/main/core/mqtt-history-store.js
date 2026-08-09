'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_CONNECTIONS = 64;
const MAX_MESSAGES_PER_CONNECTION = 500;

function historyPath() {
  return path.join(app.getPath('userData'), 'mqtt-history.json');
}

function normalizeHistory(data) {
  const source = Array.isArray(data) ? data.slice(0, MAX_CONNECTIONS) : [];
  return source.map((entry) => ({
    id: String((entry && entry.id) || '').slice(0, 128),
    messages: Array.isArray(entry && entry.messages)
      ? entry.messages.slice(-MAX_MESSAGES_PER_CONNECTION)
      : []
  })).filter((entry) => entry.id);
}

function loadMqttHistory() {
  try {
    const p = historyPath();
    const stat = fs.statSync(p);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return [];
    return normalizeHistory(JSON.parse(fs.readFileSync(p, 'utf8')));
  } catch { return []; }
}

function saveMqttHistory(data) {
  const normalized = normalizeHistory(data);
  const serialized = JSON.stringify(normalized);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_FILE_BYTES) {
    throw new Error('MQTT history exceeds storage limit');
  }
  const p = historyPath();
  const tmp = p + '.tmp';
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(tmp, serialized, 'utf8');
  try { fs.renameSync(tmp, p); }
  catch {
    fs.writeFileSync(p, serialized, 'utf8');
    try { fs.unlinkSync(tmp); } catch {}
  }
  return true;
}

module.exports = { historyPath, loadMqttHistory, saveMqttHistory, normalizeHistory };
