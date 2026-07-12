import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCSVDelimiter, inspectOperationsCSV, parseOperationsCSV } from '../src/utils/importOperations.js';

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

test('inspects delimiter and suggests a reusable column mapping', () => {
  const csv = 'Банковская выписка\nДата\tПолучатель\tСписание\tЗачисление\n01.07.2026\tМагазин\t1500,25\t';
  assert.equal(detectCSVDelimiter(csv, { headerRow: 2 }), '\t');
  assert.deepEqual(inspectOperationsCSV(csv, { format: { headerRow: 2 } }), {
    delimiter: '\t',
    headerRow: 2,
    headers: ['Дата', 'Получатель', 'Списание', 'Зачисление'],
    columns: [
      { index: 0, header: 'Дата', normalizedHeader: 'дата', suggestedField: 'date' },
      { index: 1, header: 'Получатель', normalizedHeader: 'получатель', suggestedField: 'counterparty' },
      { index: 2, header: 'Списание', normalizedHeader: 'списание', suggestedField: 'debit' },
      { index: 3, header: 'Зачисление', normalizedHeader: 'зачисление', suggestedField: 'credit' },
    ],
    suggestedMapping: { date: 0, counterparty: 1, debit: 2, credit: 3 },
    dataRowCount: 1,
  });
});

test('parses a saved debit and credit mapping and preserves counterparty', () => {
  const csv = 'Банковская выписка\nКогда|Кому|Списание|Зачисление|Комментарий\n01.07.2026|Магазин|1 500,25||Продукты\n02.07.2026|Клиент||2000|Оплата';
  const result = parseOperationsCSV(csv, {
    mapping: { date: 'Когда', counterparty: 'Кому', debit: 'Списание', credit: 'Зачисление', description: 'Комментарий' },
    format: { headerRow: 2, delimiter: '|', amountMode: 'debitCredit' },
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.rows.map(({ type, amount, counterpartyName, sourceLine }) => ({ type, amount, counterpartyName, sourceLine })), [
    { type: 'expense', amount: 1500.25, counterpartyName: 'Магазин', sourceLine: 3 },
    { type: 'income', amount: 2000, counterpartyName: 'Клиент', sourceLine: 4 },
  ]);
});

test('parses signed amounts with numeric mapping and without a header row', () => {
  const csv = '01.07.2026;-250;Такси\n02.07.2026;1000;Возврат';
  const result = parseOperationsCSV(csv, {
    mapping: { date: 0, amount: 1, counterparty: 2 },
    format: { headerRow: false, delimiter: ';', amountMode: 'signed' },
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.rows.map(({ type, amount, counterpartyName, sourceLine }) => ({ type, amount, counterpartyName, sourceLine })), [
    { type: 'expense', amount: 250, counterpartyName: 'Такси', sourceLine: 1 },
    { type: 'income', amount: 1000, counterpartyName: 'Возврат', sourceLine: 2 },
  ]);
});

test('uses a default type when the source has no type column', () => {
  const csv = 'When,Value\n2026-07-01,"1,250.50"';
  const result = parseOperationsCSV(csv, {
    mapping: { date: 'When', amount: 'Value' },
    format: { delimiter: ',', defaultType: 'expense', decimalSeparator: '.' },
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].type, 'expense');
  assert.equal(result.rows[0].amount, 1250.5);
});
