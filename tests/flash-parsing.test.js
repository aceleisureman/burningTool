const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEVID_MAP,
  parseHex32,
  parseStm32DevidFromValues,
  chooseProbe,
  cleanPyocd,
  cleanMake,
  cleanCubeMx,
  asciiTargetName
} = require('../src/main/flash/flash-parsing');

test('parseHex32 extracts value after colon, else last hex token', () => {
  assert.equal(parseHex32('0xe0042000:  0x10036410'), 0x10036410);
  assert.equal(parseHex32('value = 0x414'), 0x414);
  assert.equal(parseHex32('no hex here'), null);
});

test('parseStm32DevidFromValues parses pyOCD and OpenOCD memory read output', () => {
  assert.equal(parseStm32DevidFromValues('0xe0042000:  0x10036410').devid, 0x410);
  const openocd = '0xe0042000: 10036410\\n0x40015800: 00000000';
  const parsed = parseStm32DevidFromValues(openocd);
  assert.equal(parsed.detected, true);
  assert.equal(parsed.entry.family, 'stm32f1');
});

test('parseStm32DevidFromValues ignores unrelated hex values in logs', () => {
  const log = [
    'Info : Listening on port 3333 for gdb connections',
    'Info : some noise 0xd28',
    'shutdown command invoked'
  ].join('\n');
  assert.equal(parseStm32DevidFromValues(log).devid, null);
});

test('chooseProbe prefers valid UID + CMSIS-DAP/DAPLink', () => {
  assert.equal(chooseProbe([]), null);
  const probes = [
    { name: 'ST-Link', uid: '000000000' },
    { name: 'Arm DAPLink CMSIS-DAP', uid: '4559CBD2' }
  ];
  assert.equal(chooseProbe(probes).uid, '4559CBD2');
  // 无 DAP 时回退到第一个有效 UID
  const onlyValid = [{ name: 'Generic', uid: 'ABCD' }];
  assert.equal(chooseProbe(onlyValid).name, 'Generic');
});

test('cleanPyocd drops noise and localizes stages', () => {
  assert.equal(cleanPyocd(''), null);
  assert.equal(cleanPyocd('====----===='), null);
  assert.equal(cleanPyocd('0001583 I Erasing [loader]').text.includes('擦除'), true);
  assert.equal(cleanPyocd('Programming').text.includes('编程'), true);
  const done = cleanPyocd('programmed 12345 bytes at 10.5 kB/s');
  assert.equal(done.type, 'success');
  assert.equal(done.text.includes('12345'), true);
});

test('cleanMake compresses long command echoes', () => {
  assert.equal(cleanMake('rm -rf build'), null);
  assert.equal(
    cleanMake('arm-none-eabi-gcc -c -O2 src/main.c -o build/main.o').text,
    '  编译 main.c'
  );
  assert.equal(
    cleanMake('arm-none-eabi-gcc build/main.o -o build/app.elf').text,
    '  链接 app.elf'
  );
  // 警告/错误原样保留
  assert.equal(cleanMake('src/main.c:10: warning: unused'), 'src/main.c:10: warning: unused');
});

test('cleanCubeMx drops blank/symbol lines, indents the rest', () => {
  assert.equal(cleanCubeMx('   '), null);
  assert.equal(cleanCubeMx('===---==='), null);
  assert.equal(cleanCubeMx('Generating code').text, '  Generating code');
});

test('asciiTargetName sanitizes non-ASCII project names', () => {
  assert.equal(asciiTargetName('教室控制器'), 'firmware');
  assert.equal(asciiTargetName('my project 2'), 'my_project_2');
  assert.equal(asciiTargetName('app-v1.0'), 'app-v1.0');
  assert.equal(asciiTargetName('LED控制'), 'LED');
});

test('DEVID_MAP maps known STM32 device IDs', () => {
  assert.equal(DEVID_MAP[0x414].target, 'stm32f103rc');
  assert.equal(DEVID_MAP[0x413].family, 'stm32f4');
  assert.equal(DEVID_MAP[0x450].target, 'stm32h743xx');
});
