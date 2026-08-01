import assert from 'node:assert/strict';
import test from 'node:test';

import { isStrongPassword } from '../src/utils/passwordPolicy.js';

test('password policy requires length, upper, lower and digit', () => {
  assert.equal(isStrongPassword('shortA1'), false);
  assert.equal(isStrongPassword('alllowercase123'), false);
  assert.equal(isStrongPassword('ALLUPPERCASE123'), false);
  assert.equal(isStrongPassword('NoDigitsHere!'), false);
  assert.equal(isStrongPassword('StrongA1'), true);
});
