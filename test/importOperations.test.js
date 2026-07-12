import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOperationsCSV } from '../src/utils/importOperations.js';

test('parses exported Russian CSV and resolves dictionaries', () => {
  const csv = '\uFEFFДата;Тип;Направление перевода;Сумма;Валюта;Курс;Сумма в KZT;Счёт;Категория;Теги;Описание\r\n2026-07-01;Расход;;1 250,50;KZT;1;1250,5;Карта;Еда;дом, июль;«Продукты»';
  const result = parseOperationsCSV(csv, {
    baseCurrency: 'KZT',
    accounts: [{ id: 'account-1', name: 'Карта' }],
    categories: [{ id: 'category-1', name: 'Еда', type: 'expense' }],
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0], {
    type: 'expense',
    operation_date: '2026-07-01',
    amount: 1250.5,
    currency: 'KZT',
    exchange_rate: 1,
    base_amount: 1250.5,
    account_id: 'account-1',
    category_id: 'category-1',
    tagNames: ['дом', 'июль'],
    description: '«Продукты»',
    sourceLine: 2,
  });
});

test('reports invalid and transfer rows without importing them', () => {
  const csv = 'Дата;Тип;Сумма\n01.07.2026;Перевод;100\nbad;Доход;0';
  const result = parseOperationsCSV(csv);
  assert.equal(result.rows.length, 0);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /неподдерживаемый тип/);
  assert.match(result.errors[1], /некорректная дата/);
});

test('maps an ambiguous legacy salary by workspace mode', () => {
  const csv = 'Дата;Тип;Сумма\n01.07.2026;Зарплата;100';
  assert.equal(parseOperationsCSV(csv, { workspaceType: 'personal' }).rows[0].type, 'personal_salary');
  assert.equal(parseOperationsCSV(csv, { workspaceType: 'business' }).rows[0].type, 'employee_salary');
});
