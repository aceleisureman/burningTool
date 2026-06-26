const test = require('node:test');
const assert = require('node:assert/strict');

const {
  quoteOpenocdTclPath,
  needsOpenocdAsciiStaging
} = require('../src/main/flash/openocd-paths');

test('quoteOpenocdTclPath normalizes Windows paths for Tcl', () => {
  assert.equal(
    quoteOpenocdTclPath(String.raw`D:\project\单片机资源\stm32Cube\测试工程\build\firmware.elf`),
    '{D:/project/单片机资源/stm32Cube/测试工程/build/firmware.elf}'
  );
});

test('quoteOpenocdTclPath avoids Tcl command and variable substitution', () => {
  assert.equal(
    quoteOpenocdTclPath(String.raw`D:\work\$tmp\[debug]\firmware.elf`),
    '{D:/work/$tmp/[debug]/firmware.elf}'
  );
});

test('quoteOpenocdTclPath preserves literal backspace-like path segments', () => {
  assert.equal(
    quoteOpenocdTclPath(String.raw`D:\project\build\firmware.elf`),
    '{D:/project/build/firmware.elf}'
  );
});

test('needsOpenocdAsciiStaging stages Windows absolute paths for OpenOCD', () => {
  assert.equal(needsOpenocdAsciiStaging(String.raw`D:\project\build\firmware.elf`, 'win32'), true);
  assert.equal(needsOpenocdAsciiStaging(String.raw`D:\project\单片机资源\build\firmware.elf`, 'win32'), true);
  assert.equal(needsOpenocdAsciiStaging('/home/me/单片机资源/build/firmware.elf', 'linux'), false);
});
