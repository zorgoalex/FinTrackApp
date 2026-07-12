import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOperationsCSV } from '../src/utils/export.js';

test('builds a detailed operations CSV with lookup names and safe cells', () => {
  const csv = buildOperationsCSV([
    {
      operation_date: '2026-07-11',
      type: 'expense',
      status: 'reconciled',
      amount: 1250.5,
      currency: 'KZT',
      exchange_rate: 1,
      base_amount: 1250.5,
      account_id: 'account-1',
      counterparty_id: 'counterparty-1',
      category_id: 'category-1',
      tags: [{ name: 'Дом' }, { name: 'Срочно' }],
      description: '=HYPERLINK("https://example.com")'
    }
  ], {
    categories: [{ id: 'category-1', name: 'Продукты' }],
    accounts: [{ id: 'account-1', name: 'Карта' }],
    counterparties: [{ id: 'counterparty-1', display_name: 'Магазин' }],
    baseCurrency: 'KZT'
  });

  assert.ok(csv.startsWith('\uFEFFДата;Тип;'));
  assert.match(csv, /2026-07-11;Расход;Сверена;;1250\.5;KZT;1;1250\.5;Карта;Магазин;Продукты;Дом, Срочно;/);
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.com""\)"/);
});

test('includes transfer direction and escapes delimiters', () => {
  const csv = buildOperationsCSV([
    {
      operation_date: '2026-07-10',
      type: 'transfer',
      status: 'verified',
      transfer_direction: 'out',
      amount: 100,
      description: 'Карта; наличные'
    }
  ]);

  assert.match(csv, /Перевод;Проверена;Исходящий;100/);
  assert.match(csv, /"Карта; наличные"/);
});
