const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizePyocdTarget, isStm32Target, openocdTargetConfig } = require('../src/main/flash/stm32-targets');

test('normalizes STM32 order codes to pyOCD target names', () => {
  assert.equal(normalizePyocdTarget('STM32F103C8T6'), 'stm32f103c8');
  assert.equal(normalizePyocdTarget('STM32F103CBT6'), 'stm32f103cb');
  assert.equal(normalizePyocdTarget('STM32F407VET6'), 'stm32f407ve');
  assert.equal(normalizePyocdTarget('STM32H743VIT6'), 'stm32h743vi');
});

test('keeps existing pyOCD target names unchanged', () => {
  assert.equal(normalizePyocdTarget('stm32f103c8'), 'stm32f103c8');
  assert.equal(normalizePyocdTarget('stm32h743xx'), 'stm32h743xx');
  assert.equal(normalizePyocdTarget('cortex_m'), 'cortexm');
});

test('detects STM32 targets', () => {
  assert.equal(isStm32Target('stm32f103c8'), true);
  assert.equal(isStm32Target('STM32H743VIT6'), true);
  assert.equal(isStm32Target('cortex_m'), false);
});

test('maps STM32 targets to OpenOCD target cfg files', () => {
  assert.equal(openocdTargetConfig('STM32F103C8T6'), 'target/stm32f1x.cfg');
  assert.equal(openocdTargetConfig('STM32F407VET6'), 'target/stm32f4x.cfg');
  assert.equal(openocdTargetConfig('STM32H743VIT6'), 'target/stm32h7x.cfg');
});
