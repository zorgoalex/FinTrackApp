import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectTapOutput } from '../scripts/run-sql-tests.mjs';

test('SQL gate accepts a fully passing TAP stream', () => {
  const result = inspectTapOutput('1..2\nok 1 - first\nok 2 - second\n');
  assert.equal(result.failed, false);
  assert.deepEqual(result.failedAssertions, []);
});

test('SQL gate rejects not ok even when psql itself exits successfully', () => {
  const result = inspectTapOutput('1..2\nok 1 - first\nnot ok 2 - second\n');
  assert.equal(result.failed, true);
  assert.deepEqual(result.failedAssertions, ['not ok 2 - second']);
});

test('SQL gate rejects a pgTAP failed-test summary', () => {
  const result = inspectTapOutput('# Failed test 3: "broken invariant"\n');
  assert.equal(result.failed, true);
});
