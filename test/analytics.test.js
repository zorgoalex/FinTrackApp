import test from 'node:test';
import assert from 'node:assert/strict';

import { computeAnalytics } from '../src/utils/analytics/aggregations.js';

test('computes both salary directions in workspace base currency', () => {
  const result = computeAnalytics([
    { type: 'income', amount: 10, base_amount: 1000 },
    { type: 'expense', amount: 5, base_amount: 300 },
    { type: 'personal_salary', amount: 2, base_amount: 200 },
    { type: 'employee_salary', amount: 2, base_amount: 250 },
    { type: 'transfer', amount: 5000, base_amount: 5000 },
  ]);

  assert.equal(result.totalIncome, 1200);
  assert.equal(result.totalExpense, 300);
  assert.equal(result.totalSalary, 250);
  assert.equal(result.totalOutflow, 550);
  assert.equal(result.balance, 650);
  assert.equal(result.operationCount, 5);
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

test('counts a transfer pair as one user operation and aggregates its tags once', () => {
  const transferTag = { id: 'internal' };
  const result = computeAnalytics(
    [
      {
        type: 'transfer',
        amount: 100,
        transfer_group_id: 'transfer-1',
        transfer_direction: 'out',
        tags: [transferTag],
      },
      {
        type: 'transfer',
        amount: 85,
        transfer_group_id: 'transfer-1',
        transfer_direction: 'in',
        tags: [transferTag],
      },
    ],
    [],
    [{ id: 'internal', name: 'Перевод', color: '#123456' }],
  );

  assert.equal(result.operationCount, 1);
  assert.equal(result.tagBreakdown[0].count, 1);
  assert.equal(result.tagBreakdown[0].amount, 100);
});

test('uses split allocations for category analytics without double counting parent', () => {
  const result = computeAnalytics([{
    id: 'split-1', type: 'expense', amount: 100, base_amount: 100, category_id: 'legacy',
    operation_allocations: [
      { category_id: 'rent', amount: 60, base_amount: 60 },
      { category_id: 'services', amount: 40, base_amount: 40 },
    ],
  }], [
    { id: 'legacy', name: 'Legacy', type: 'expense' },
    { id: 'rent', name: 'Rent', type: 'expense' },
    { id: 'services', name: 'Services', type: 'expense' },
  ]);

  assert.deepEqual(result.categoryBreakdown.map((item) => [item.categoryId, item.amount]), [
    ['rent', 60], ['services', 40],
  ]);
  assert.equal(result.totalExpense, 100);
});
