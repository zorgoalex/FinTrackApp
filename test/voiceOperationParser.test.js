import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVoiceOperationTranscript } from '../src/utils/voiceOperationParser.js';

const categories = [
  { id: 'taxi', name: 'Такси', type: 'expense', is_archived: false },
  { id: 'salary', name: 'Зарплата', type: 'income', is_archived: false },
];
const accounts = [
  { id: 'kaspi', name: 'Kaspi Gold', is_archived: false },
  { id: 'halyk', name: 'Halyk Bonus', is_archived: false },
];

test('parses a numeric Russian expense into a safe editable patch', () => {
  const result = parseVoiceOperationTranscript('Запиши расход 5 000 тенге на Такси, счёт Kaspi Gold', {
    fallbackType: 'income', categories, accounts, now: new Date(2026, 6, 12),
  });
  assert.deepEqual(result.patch, {
    type: 'expense',
    description: 'Запиши расход 5 000 тенге на Такси, счёт Kaspi Gold',
    amount: '5000',
    categoryId: 'taxi',
    accountId: 'kaspi',
  });
  assert.equal(result.hasCriticalAmount, true);
});
test('parses Russian number words and a relative date', () => {
  const result = parseVoiceOperationTranscript('Вчера потратил пять тысяч двести тенге на такси', {
    categories, accounts, now: new Date(2026, 6, 12),
  });
  assert.equal(result.patch.amount, '5200');
  assert.equal(result.patch.operationDate, '2026-07-11');
  assert.equal(result.patch.categoryId, 'taxi');
});

test('maps two named accounts in order for a transfer', () => {
  const result = parseVoiceOperationTranscript('Переведи 25000 тенге с Kaspi Gold на Halyk Bonus', {
    fallbackType: 'expense', categories, accounts,
  });
  assert.equal(result.patch.type, 'transfer');
  assert.equal(result.patch.amount, '25000');
  assert.equal(result.patch.fromAccountId, 'kaspi');
  assert.equal(result.patch.toAccountId, 'halyk');
  assert.equal(result.patch.categoryId, undefined);
});

test('does not invent a monetary amount from a standalone year', () => {
  const result = parseVoiceOperationTranscript('Расход за 2026 год на такси', {
    fallbackType: 'expense', categories, accounts,
  });
  assert.equal(result.patch.amount, undefined);
  assert.equal(result.hasCriticalAmount, false);
});
