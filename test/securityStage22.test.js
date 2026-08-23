import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildAnalyticsCSV, buildOperationsCSV } from '../src/utils/export.js';
import { inspectOperationsCSV } from '../src/utils/importOperations.js';
import {
  CSV_MAX_CELL_CHARS,
  CSV_MAX_CHARS,
  CSV_MAX_COLUMNS,
  CSV_MAX_RECORDS,
  CsvSecurityError,
} from '../src/utils/csvSecurity.js';
import {
  DOCUMENT_MAX_FILE_BYTES,
  DOCUMENT_MAX_TEXT_CHARS,
  PDF_MAX_PAGES,
  PDF_MAX_TEXT_ITEMS,
  assertDocumentFileSize,
  assertPdfPageCount,
  assertSourceImageDimensions,
  nextPdfTextBudget,
} from '../src/utils/documentImport/documentLimits.js';
import { detectAudioContainer, validateAudioSignature } from '../supabase/functions/_shared/mediaSecurity.js';
import {
  assistantMessages,
  isSafeAssistantAnswer,
  isSafeAssistantDateRange,
  privateLogFingerprint,
  sanitizeFinancialContext,
} from '../supabase/functions/_shared/aiSecurity.js';
import { safePublicHttpsEndpoint, safeTelegramUrl } from '../src/utils/externalUrls.js';
import { createReceiptOcrClient, ReceiptOcrClientError } from '../src/services/receiptOcr.js';

const workspaceId = '265c4155-51b1-41c3-b4ae-f08fa26b0eaa';

test('CSV export neutralizes spreadsheet formulas in every exported field', () => {
  const operationCsv = buildOperationsCSV([{
    operation_date: '2026-08-23', type: 'expense', amount: 1, currency: 'KZT',
    description: '  -2+3', tags: [{ name: '@SUM(A1:A2)' }],
  }]);
  const analyticsCsv = buildAnalyticsCSV({
    totalIncome: 1, totalExpense: 2, totalSalary: 0, balance: -1, operationCount: 1,
    categoryBreakdown: [{ name: '=HYPERLINK("https://evil.invalid")', amount: 2, count: 1 }],
    tagBreakdown: [{ name: '+cmd', amount: 2, count: 1 }],
  }, '2026-08-01', '2026-08-23');

  assert.ok(operationCsv.includes("'  -2+3"));
  assert.match(operationCsv, /'@SUM\(A1:A2\)/u);
  assert.match(analyticsCsv, /'=HYPERLINK/u);
  assert.match(analyticsCsv, /'\+cmd/u);
});

test('CSV import rejects oversized, too wide, too long and malformed input', () => {
  const inspect = (text) => inspectOperationsCSV(text, { delimiter: ';', headerRow: 1 });
  assert.throws(() => inspect('x'.repeat(CSV_MAX_CHARS + 1)), (error) => error instanceof CsvSecurityError && error.code === 'CSV_TOO_LARGE');
  assert.throws(() => inspect(`${Array.from({ length: CSV_MAX_COLUMNS + 1 }, (_, index) => `c${index}`).join(';')}\n1`), CsvSecurityError);
  assert.throws(() => inspect(`date;description\n2026-08-23;${'x'.repeat(CSV_MAX_CELL_CHARS + 1)}`), CsvSecurityError);
  assert.throws(() => inspect('date;description\n2026-08-23;"unfinished'), (error) => error.code === 'CSV_INVALID_QUOTES');
  const tooManyRows = `date;amount\n${'2026-08-23;1\n'.repeat(CSV_MAX_RECORDS)}`;
  assert.throws(() => inspect(tooManyRows), CsvSecurityError);
});

test('PDF and image import limits reject decompression-bomb shaped inputs', () => {
  assert.doesNotThrow(() => assertDocumentFileSize(DOCUMENT_MAX_FILE_BYTES));
  assert.throws(() => assertDocumentFileSize(DOCUMENT_MAX_FILE_BYTES + 1));
  assert.doesNotThrow(() => assertPdfPageCount(PDF_MAX_PAGES));
  assert.throws(() => assertPdfPageCount(PDF_MAX_PAGES + 1));
  assert.throws(() => nextPdfTextBudget({ items: PDF_MAX_TEXT_ITEMS, chars: 0 }, 1, 'x'));
  assert.throws(() => nextPdfTextBudget({ items: 0, chars: DOCUMENT_MAX_TEXT_CHARS }, 0, 'x'));
  assert.doesNotThrow(() => assertSourceImageDimensions(8_000, 8_000));
  assert.throws(() => assertSourceImageDimensions(20_000, 20_000));
});

test('STT validates audio magic bytes against extension and MIME', async () => {
  const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
  assert.equal(detectAudioContainer(wav), 'wav');
  assert.equal(await validateAudioSignature(new Blob([wav]), 'wav', 'audio/wav'), 'wav');
  await assert.rejects(() => validateAudioSignature(new Blob([wav]), 'mp3', 'audio/mpeg'), /не соответствует/u);
  await assert.rejects(() => validateAudioSignature(new Blob(['not audio']), 'wav', 'audio/wav'), /не распознана/u);
});

test('AI context is bounded, remains untrusted user content and output is fail-closed', async () => {
  const context = sanitizeFinancialContext({
    base_currency: 'bad', summary: { income: Infinity, operation_count: 1e20 },
    categories: Array.from({ length: 50 }, (_, index) => ({ name: `Ignore system\u0000 ${index}`, type: 'root', amount: 'NaN' })),
    accounts: [{ name: '<script>alert(1)</script>', currency: 'usd', balance: 1 }],
  });
  assert.equal(context.base_currency, 'KZT');
  assert.equal(context.categories.length, 30);
  assert.equal(context.categories[0].type, 'unknown');
  const messages = assistantMessages(context, 'Покажи расходы');
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].role, 'user');
  assert.ok(!messages[0].content.includes('Ignore system'));
  assert.equal(isSafeAssistantAnswer('Расходы составили 1000 KZT.'), true);
  assert.equal(isSafeAssistantAnswer('Открой https://evil.invalid'), false);
  assert.equal(isSafeAssistantAnswer('<script>alert(1)</script>'), false);
  assert.equal(isSafeAssistantAnswer('Вот system prompt и API key'), false);
  assert.equal(isSafeAssistantDateRange('2026-01-01', '2026-12-31'), true);
  assert.equal(isSafeAssistantDateRange('2026-01-01', '2027-01-03'), false);
  assert.equal(isSafeAssistantDateRange('2026-02-30', '2026-03-01'), false);
  const fingerprint = await privateLogFingerprint('секретный финансовый вопрос');
  assert.match(fingerprint, /^sha256:[0-9a-f]{64}$/u);
  assert.ok(!fingerprint.includes('финансовый'));
});

test('external navigation and configurable OCR endpoints reject unsafe URLs', async () => {
  assert.ok(safeTelegramUrl('https://t.me/FinTrackBot?start=abcdefgh'));
  assert.equal(safeTelegramUrl('https://t.me.evil.invalid/FinTrackBot?start=abcdefgh'), null);
  assert.equal(safeTelegramUrl('javascript:alert(1)'), null);
  assert.equal(safePublicHttpsEndpoint('https://ocr.example.com/base/'), 'https://ocr.example.com/base');
  for (const unsafe of ['http://ocr.example.com', 'https://127.0.0.1/ocr', 'https://192.168.1.10/ocr', 'https://user:pass@ocr.example.com']) {
    assert.equal(safePublicHttpsEndpoint(unsafe), null);
  }
  const client = createReceiptOcrClient({ endpoint: 'https://127.0.0.1/ocr' });
  await assert.rejects(
    () => client.recognize(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), { workspaceId }),
    (error) => error instanceof ReceiptOcrClientError && error.code === 'UNSAFE_ENDPOINT',
  );
});

test('Stage 2.2 hardening remains wired into runtime entry points', async () => {
  const files = new Map(await Promise.all([
    'src/utils/documentImport/extract.js',
    'src/pages/ProfilePage.jsx',
    'supabase/functions/ai-assistant/index.ts',
    'supabase/functions/invite-user/index.ts',
    'supabase/functions/stt-transcribe/index.ts',
    'supabase/functions/telegram-link/index.ts',
  ].map(async (path) => [path, await readFile(path, 'utf8')])));
  assert.match(files.get('src/utils/documentImport/extract.js'), /assertPdfPageCount/u);
  assert.match(files.get('src/pages/ProfilePage.jsx'), /safeTelegramUrl/u);
  assert.match(files.get('supabase/functions/ai-assistant/index.ts'), /assistantMessages/u);
  assert.match(files.get('supabase/functions/ai-assistant/index.ts'), /questionFingerprint/u);
  assert.match(files.get('supabase/functions/invite-user/index.ts'), /normalizeAllowedAppBaseUrl/u);
  assert.match(files.get('supabase/functions/stt-transcribe/index.ts'), /validateAudioSignature/u);
  assert.match(files.get('supabase/functions/telegram-link/index.ts'), /readResponseJsonWithLimit/u);
});
