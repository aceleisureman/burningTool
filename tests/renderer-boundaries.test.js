'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('large serial and MQTT pages use scoped domains and views are lazy loaded', () => {
  const root = path.join(__dirname, '..', 'renderer', 'src');
  const app = fs.readFileSync(path.join(root, 'App.vue'), 'utf8');
  const serial = fs.readFileSync(path.join(root, 'views', 'SerialView.vue'), 'utf8');
  const mqtt = fs.readFileSync(path.join(root, 'views', 'MqttView.vue'), 'utf8');
  assert.match(app, /defineAsyncComponent\(\(\) => import\('\.\/views\/SerialView\.vue'\)\)/);
  assert.match(serial, /inject\('serial'\)/);
  assert.match(mqtt, /inject\('mqtt'\)/);
  assert.doesNotMatch(serial, /inject\('appContext'\)/);
  assert.doesNotMatch(mqtt, /inject\('appContext'\)/);
});
