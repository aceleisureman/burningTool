const test = require('node:test');
const assert = require('node:assert/strict');

const { runProcess, killAllRunningProcesses, activeProcessCount } = require('../src/main/toolchain/proc');

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
