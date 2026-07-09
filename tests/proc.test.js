const test = require('node:test');
const assert = require('node:assert/strict');

const { runProcess } = require('../src/main/toolchain/proc');

test('runProcess returns timedOut result when command exceeds timeout', async () => {
  const result = await runProcess(
    process.execPath,
    ['-e', 'setTimeout(() => {}, 200)'],
    { shell: false, capture: true, timeoutMs: 50 }
  );

  assert.equal(result.code, -2);
  assert.equal(result.timedOut, true);
});
