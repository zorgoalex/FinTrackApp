import test from 'node:test';
import assert from 'node:assert/strict';
import { getDebtAging, matchesDebtStatus, sortDebtsByUrgency } from '../src/utils/debtAging.js';

const referenceDate = new Date('2026-07-12T12:00:00');
const debt = (overrides = {}) => ({ remaining_amount: 100, due_on: null, is_archived: false, ...overrides });

test('classifies overdue, today, upcoming and undated debts', () => {
  assert.deepEqual(getDebtAging(debt({ due_on: '2026-07-09' }), referenceDate), { key: 'overdue', label: 'Просрочен на 3 дн.', days: -3 });
  assert.equal(getDebtAging(debt({ due_on: '2026-07-12' }), referenceDate).key, 'due_today');
  assert.equal(getDebtAging(debt({ due_on: '2026-07-17' }), referenceDate).key, 'due_soon');
  assert.equal(getDebtAging(debt({ due_on: '2026-08-01' }), referenceDate).key, 'later');
  assert.equal(getDebtAging(debt(), referenceDate).key, 'no_due');
});

test('treats paid and archived debts as closed', () => {
  assert.equal(getDebtAging(debt({ remaining_amount: 0, due_on: '2026-07-01' }), referenceDate).key, 'closed');
  assert.equal(getDebtAging(debt({ is_archived: true, due_on: '2026-07-01' }), referenceDate).key, 'closed');
});

test('puts the most urgent debts first and supports the urgent filter', () => {
  const items = [
    debt({ id: 'later', due_on: '2026-08-01' }),
    debt({ id: 'soon', due_on: '2026-07-15' }),
    debt({ id: 'overdue', due_on: '2026-07-01' }),
    debt({ id: 'none' }),
  ];
  assert.deepEqual(sortDebtsByUrgency(items, referenceDate).map((item) => item.id), ['overdue', 'soon', 'later', 'none']);
  assert.deepEqual(items.filter((item) => matchesDebtStatus(item, 'urgent', referenceDate)).map((item) => item.id), ['soon', 'overdue']);
});
