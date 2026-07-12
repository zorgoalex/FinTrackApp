import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSensitiveData, redactSensitiveText } from '../src/utils/documentImport/privacy.js';
import { parseBankDocumentText } from '../src/utils/documentImport/parsers.js';

test('parses Kaspi statement rows into an editable operation draft', async () => {
  const text = `ВЫПИСКА по Kaspi Gold
Дата Сумма Операция Детали
30.06.25 - 1 450,00 ₸ Покупка Altel
30.06.25 + 10 000,00 ₸ Пополнение Клиент банка
29.06.25 - 650,00 ₸ Покупка Coffee shop
АО «Kaspi Bank»`;
  const result = await parseBankDocumentText(text, 'pdf');
  assert.equal(result.bank, 'kaspi');
  assert.equal(result.documentType, 'statement');
  assert.equal(result.operations.length, 3);
  assert.deepEqual(
    result.operations.map(({ operation_date, type, amount, currency }) => ({ operation_date, type, amount, currency })),
    [
      { operation_date: '2025-06-30', type: 'expense', amount: 1450, currency: 'KZT' },
      { operation_date: '2025-06-30', type: 'income', amount: 10000, currency: 'KZT' },
      { operation_date: '2025-06-29', type: 'expense', amount: 650, currency: 'KZT' },
    ],
  );
});

test('parses multi-currency Freedom statement rows', async () => {
  const text = `Выписка по карте Freedom Card
Дата Сумма Валюта Операция Детали
28.06.2025 -252.00 ₸ KZT Покупка SMALL SUPERMARKET ASTANA KZ
27.06.2025 +30,000.00 ₸ KZT Пополнение CASH IN ASTANA KZ
16.06.2025 -10.00 $ USD Покупка SOFTWARE SERVICE US
Подлинность справки можете проверить`;
  const result = await parseBankDocumentText(text, 'pdf');
  assert.equal(result.bank, 'freedom');
  assert.equal(result.operations.length, 3);
  assert.equal(result.operations[1].amount, 30000);
  assert.equal(result.operations[2].currency, 'USD');
});

test('parses a receipt and redacts personal identifiers before draft display', async () => {
  const text = `Налоги
Платеж успешно совершен
15 289,00 ₸
ИИН 980806450265
ФИО плательщика Иванов Иван Иванович
Дата и время 06.04.2026 16:52:23
Оплачено с Kaspi Gold`;
  const result = await parseBankDocumentText(text, 'image');
  assert.equal(result.operations.length, 1);
  assert.equal(result.operations[0].amount, 15289);
  assert.doesNotMatch(result.operations[0].description, /980806450265|Иванов/);
  assert.ok(detectSensitiveData(text).some((item) => item.type === 'iin_bin'));
  assert.match(redactSensitiveText('Счет KZ24070105KSN0000000'), /скрыто: банковский счёт/);
});

test('supports photographed fiscal receipts with hyphen dates and Kazakh totals', async () => {
  const text = `САТУ ЧЕГІ 2
08-11-2024 09:34
ЖАЛПЫ ТӨЛЕМГЕ =1340.00
БЕЗНАЛИЧНЫМИ =1340.00`;
  const result = await parseBankDocumentText(text, 'image');
  assert.equal(result.documentType, 'receipt');
  assert.equal(result.operations.length, 1);
  assert.equal(result.operations[0].operation_date, '2024-11-08');
  assert.equal(result.operations[0].amount, 1340);
});

test('keeps an incomplete receipt as an unconfirmed editable draft', async () => {
  const result = await parseBankDocumentText('ПРОДАЖА\nИТОГ: 1150.00\nФИСКАЛЬНЫЙ ЧЕК', 'image');
  assert.equal(result.operations.length, 1);
  assert.equal(result.operations[0].operation_date, '');
  assert.equal(result.operations[0].amount, 1150);
  assert.equal(result.operations[0].confidence, 0.55);
});
