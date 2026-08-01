import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

test('public beta terms cover backup, transient OCR, retention, support and deletion', async () => {
  const source = await readFile(new URL('../src/pages/LegalPage.jsx', import.meta.url), 'utf8');
  for (const required of ['JSON-backup', 'GLM-OCR', 'Срок хранения и удаление', 'VITE_SUPPORT_EMAIL', '7 календарных дней']) {
    assert.match(source, new RegExp(required));
  }
});
