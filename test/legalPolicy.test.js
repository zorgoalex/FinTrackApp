import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

test('public beta terms disclose processors, concrete retention, backup residue and deletion', async () => {
  const source = await readFile(new URL('../src/pages/LegalPage.jsx', import.meta.url), 'utf8');
  for (const required of ['JSON-backup', 'GLM-OCR', 'Срок хранения и удаление', 'VITE_SUPPORT_EMAIL', '7 календарных дней']) {
    assert.match(source, new RegExp(required));
  }
  assert.match(source, /офлайн-работа с финансовыми данными отключена/);
  for (const required of ['Supabase', 'Vercel', 'Cloudflare Turnstile', 'Resend', 'OpenRouter', 'Groq', '90 дней', '30 дней', '14 дней', '100 дней']) {
    assert.match(source, new RegExp(required));
  }
  assert.match(source, /общие финансовые записи остаются/);
  assert.match(source, /зашифрованной копии/);
});
