const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseMakefileAsmSources,
  ensureMakefileStartupSources
} = require('../src/main/flash/makefile-startup-repair');

test('parseMakefileAsmSources reads multiline ASM_SOURCES entries', () => {
  const txt = [
    'ASM_SOURCES =  \\',
    'startup_stm32f103xb.s \\',
    'Core/Startup/extra.S',
    '',
    'ASMM_SOURCES = '
  ].join('\n');
  assert.deepEqual(parseMakefileAsmSources(txt), ['startup_stm32f103xb.s', 'Core/Startup/extra.S']);
});

test('parseMakefileAsmSources reads ASOURCES entries from hand-written Makefiles', () => {
  const txt = 'ASOURCES = Drivers/CMSIS/Device/ST/STM32F1xx/Source/Templates/gcc/startup_stm32f103xb.s\n';
  assert.deepEqual(parseMakefileAsmSources(txt), [
    'Drivers/CMSIS/Device/ST/STM32F1xx/Source/Templates/gcc/startup_stm32f103xb.s'
  ]);
});

test('ensureMakefileStartupSources copies missing startup file from local GCC template', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-startup-'));
  try {
    fs.writeFileSync(path.join(dir, 'Makefile'), [
      'ASM_SOURCES =  \\',
      'startup_stm32f103xb.s',
      '',
      'C_DEFS = -DSTM32F103xB',
      ''
    ].join('\n'));
    const templateDir = path.join(dir, 'Drivers', 'CMSIS', 'Device', 'ST', 'STM32F1xx', 'Source', 'Templates', 'gcc');
    fs.mkdirSync(templateDir, { recursive: true });
    fs.writeFileSync(path.join(templateDir, 'startup_stm32f103xb.s'), [
      '.syntax unified',
      'Reset_Handler:',
      '  bl SystemInit',
      '  .word USART1_IRQHandler',
      ''
    ].join('\n'));

    const result = ensureMakefileStartupSources(dir);

    assert.deepEqual(result, { created: ['startup_stm32f103xb.s'], missing: [], failed: [] });
    const startup = fs.readFileSync(path.join(dir, 'startup_stm32f103xb.s'), 'utf8');
    assert.match(startup, /Reset_Handler:/);
    assert.match(startup, /\.word\s+USART1_IRQHandler/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ensureMakefileStartupSources copies missing startup file from Cube repository', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-startup-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-cube-repo-'));
  try {
    fs.writeFileSync(path.join(dir, 'Makefile'), [
      'ASM_SOURCES =  \\',
      'startup_stm32f103xb.s',
      ''
    ].join('\n'));
    const templateDir = path.join(repo, 'STM32Cube_FW_F1_V1.8.7', 'Drivers', 'CMSIS', 'Device', 'ST', 'STM32F1xx', 'Source', 'Templates', 'gcc');
    fs.mkdirSync(templateDir, { recursive: true });
    fs.writeFileSync(path.join(templateDir, 'startup_stm32f103xb.s'), 'Reset_Handler:\n');

    const result = ensureMakefileStartupSources(dir, { repositoryRoots: [repo] });

    assert.deepEqual(result, { created: ['startup_stm32f103xb.s'], missing: [], failed: [] });
    assert.equal(fs.readFileSync(path.join(dir, 'startup_stm32f103xb.s'), 'utf8'), 'Reset_Handler:\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
