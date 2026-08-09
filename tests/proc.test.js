const test = require('node:test');
const assert = require('node:assert/strict');

const { runProcess, runCapture, killAllRunningProcesses, activeProcessCount } = require('../src/main/toolchain/proc');

test('runProcess returns timedOut result when command exceeds timeout', async () => {
  const result = await runProcess(
    process.execPath,
    ['-e', 'setTimeout(() => {}, 200)'],
    { shell: false, capture: true, timeoutMs: 50 }
  );

  assert.equal(result.code, -2);
  assert.equal(result.timedOut, true);
});


test('killAllRunningProcesses terminates tracked children', async () => {
  const pending = runProcess(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    { shell: false, capture: true, timeoutMs: 5000 }
  );
  // give child a moment to spawn and register
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(activeProcessCount() >= 1);
  const killed = killAllRunningProcesses('test');
  assert.ok(killed.killed >= 1);
  const result = await pending;
  assert.notEqual(result.code, 0);
});

test('runCapture bounds captured output and keeps the tail', async () => {
  const result = await runCapture(
    process.execPath,
    ['-e', "process.stdout.write('A'.repeat(4096) + 'TAIL')"],
    { shell: false, maxCaptureBytes: 1024 }
  );

  assert.equal(result.code, 0);
  assert.equal(result.truncated, true);
  assert.match(result.out, /前部内容已截断/);
  assert.equal(result.out.endsWith('TAIL'), true);
  assert.ok(Buffer.byteLength(result.out, 'utf8') < 1300);
});

test('runProcess bounds a long line without waiting for a newline', async () => {
  const result = await runProcess(
    process.execPath,
    ['-e', "process.stdout.write('B'.repeat(4096) + 'END')"],
    { shell: false, capture: true, maxCaptureBytes: 1024, maxLineChars: 256 }
  );

  assert.equal(result.code, 0);
  assert.equal(result.truncated, true);
  assert.equal(result.out.trimEnd().endsWith('END'), true);
});

test('capture truncation keeps valid UTF-8 at the retained boundary', async () => {
  const result = await runCapture(
    process.execPath,
    ['-e', "process.stdout.write('中'.repeat(1000) + '结尾')"],
    { shell: false, maxCaptureBytes: 1025 }
  );

  assert.equal(result.truncated, true);
  assert.equal(result.out.includes('\uFFFD'), false);
  assert.equal(result.out.endsWith('结尾'), true);
});
