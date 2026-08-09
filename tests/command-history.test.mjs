import test from 'node:test';
import assert from 'node:assert/strict';
import { useCommandHistory } from '../renderer/src/composables/useCommandHistory.js';

test('command history deduplicates adjacent commands and enforces its limit', () => {
  const history = useCommandHistory(2);
  history.record('AT', false);
  history.record('AT', false);
  history.record('AA 55', true);
  history.record('AT+GMR', false);
  assert.deepEqual(history.items.value.map(({ text, hex }) => ({ text, hex })), [
    { text: 'AT+GMR', hex: false },
    { text: 'AA 55', hex: true }
  ]);
  history.clear();
  assert.equal(history.items.value.length, 0);
});
