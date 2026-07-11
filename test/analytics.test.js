import test from 'node:test';
import assert from 'node:assert/strict';

import { computeAnalytics } from '../src/utils/analytics/aggregations.js';

test('computes income, expenses and salary in workspace base currency', () => {
  const result = computeAnalytics([
    { type: 'income', amount: 10, base_amount: 1000 },
    { type: 'expense', amount: 5, base_amount: 300 },
    { type: 'salary', amount: 2, base_amount: 200 },
    { type: 'transfer', amount: 5000, base_amount: 5000 },
  ]);

  assert.equal(result.totalIncome, 1000);
  assert.equal(result.totalExpense, 300);
  assert.equal(result.totalSalary, 200);
  assert.equal(result.balance, 500);
  assert.equal(result.operationCount, 4);
});

test('falls back to operation amount and aggregates categories and tags', () => {
  const result = computeAnalytics(
    [
      {
        type: 'expense',
        amount: '75.50',
        category_id: 'food',
        tags: [{ id: 'family' }],
      },
      {
        type: 'expense',
        amount: 100,
        base_amount: 125,
        category_id: 'food',
        tags: [{ id: 'family' }],
      },
    ],
    [{ id: 'food', name: 'Продукты', type: 'expense', color: '#123456' }],
    [{ id: 'family', name: 'Семья', color: '#654321' }],
  );

  assert.equal(result.totalExpense, 200.5);
  assert.deepEqual(result.categoryBreakdown[0], {
    categoryId: 'food',
    name: 'Продукты',
    type: 'expense',
    color: '#123456',
    amount: 200.5,
    count: 2,
  });
  assert.equal(result.tagBreakdown[0].amount, 200.5);
  assert.equal(result.tagBreakdown[0].count, 2);
});
