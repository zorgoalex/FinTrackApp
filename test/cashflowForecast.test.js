import test from 'node:test';
import assert from 'node:assert/strict';
import { addScheduledDate, buildCashflowForecast, expandScheduled } from '../src/utils/cashflowForecast.js';

test('keeps monthly schedules on the last valid day', () => {
  assert.equal(addScheduledDate('2026-01-31', 'monthly', 31, 1), '2026-02-28');
  assert.equal(addScheduledDate('2026-02-28', 'monthly', 31, 1), '2026-03-31');
});

test('expands recurring expenses within the selected horizon', () => {
  const events = expandScheduled([{ id: 'rent', is_active: true, next_date: '2026-07-15', frequency: 'monthly', anchor_day: 15, amount: 100, type: 'expense', description: 'Аренда' }], '2026-07-01', '2026-09-30');
  assert.deepEqual(events.map((event) => event.date), ['2026-07-15', '2026-08-15', '2026-09-15']);
});

test('finds the first cash gap and minimum projected balance', () => {
  const result = buildCashflowForecast({ openingBalance: 500, plans: [
    { id: '1', date: '2026-07-10', title: 'Аренда', direction: 'expense', amount: 700 },
    { id: '2', date: '2026-07-15', title: 'Оплата клиента', direction: 'income', amount: 400 },
  ] });
  assert.equal(result.firstGapDate, '2026-07-10');
  assert.equal(result.minimumBalance, -200);
  assert.equal(result.closingBalance, 200);
});
