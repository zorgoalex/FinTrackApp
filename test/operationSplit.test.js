import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialSplitParts, splitAmountNumber, splitPartsMatchTotal } from '../src/utils/operationSplit.js';

test('split amount parser accepts comma decimals', () => {
  assert.equal(splitAmountNumber('1 234,56'), 1234.56);
});

test('initial split preserves odd cents', () => {
  const parts = createInitialSplitParts({ amount: 10.01, workspace_id: 'w1', account_id: 'a1' });
  assert.deepEqual(parts.map((part) => part.amount), ['5.01', '5.00']);
  assert.equal(splitPartsMatchTotal(parts, 10.01), true);
});

test('split total requires at least two positive exact-cent parts', () => {
  assert.equal(splitPartsMatchTotal([{ amount: 4 }, { amount: 6 }], 10), true);
  assert.equal(splitPartsMatchTotal([{ amount: 4 }, { amount: 5.99 }], 10), false);
  assert.equal(splitPartsMatchTotal([{ amount: 10 }, { amount: 0 }], 10), false);
});
