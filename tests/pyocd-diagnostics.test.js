const test = require('node:test');
const assert = require('node:assert/strict');

const { diagnoseOpenocdOutput, diagnosePyocdOutput } = require('../src/main/flash/pyocd-diagnostics');

test('diagnoses unsupported pyOCD target', () => {
  const items = diagnosePyocdOutput('Target type stm32f103c8 not recognized', { target: 'stm32f103c8' });
  assert.equal(items[0].reason, 'pyOCD 不支持当前目标型号');
});

test('diagnoses flash program failure', () => {
  const items = diagnosePyocdOutput('flash program page failure (address 0x08000000; result code 0x1)');
  assert.equal(items[0].reason, 'Flash 写入失败');
});

test('diagnoses missing probe', () => {
  const items = diagnosePyocdOutput('No connected debug probes');
  assert.equal(items[0].reason, '未检测到烧录器');
});

test('diagnoses unstable SWD connection', () => {
  const items = diagnosePyocdOutput('memory transfer failed timeout');
  assert.equal(items[0].reason, 'SWD 通信不稳定');
});

test('diagnoses OpenOCD missing target voltage', () => {
  const items = diagnoseOpenocdOutput('Error: target voltage may be too low for reliable debugging');
  assert.equal(items[0].reason, 'OpenOCD 检测到目标板供电异常');
});
