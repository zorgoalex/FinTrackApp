import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

test('Stage 3.1 enforces fingerprints and server-only AI audit writes', async () => {
  const [migration, edge] = await Promise.all([
    readFile(new URL('../supabase/migrations/20260823020000_privacy_lifecycle_hardening.sql', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/ai-assistant/index.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(migration, /question !~ '\^sha256:/u);
  assert.match(migration, /REVOKE INSERT ON public\.ai_assistant_logs FROM authenticated/u);
  assert.equal((edge.match(/admin\.from\('ai_assistant_logs'\)\.insert/g) || []).length, 3);
  assert.doesNotMatch(edge, /supabase\.from\('ai_assistant_logs'\)\.insert/u);
});

test('Stage 3.1 retention covers every bounded transient store and daily scheduling', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20260823020000_privacy_lifecycle_hardening.sql', import.meta.url),
    'utf8',
  );
  for (const table of [
    'ai_assistant_logs',
    'workspace_invitations',
    'telegram_link_tokens',
    'password_policy_proofs',
    'security_rate_limits',
    'telegram_webhook_updates',
    'financial_write_requests',
    'offline_operation_requests',
  ]) assert.match(migration, new RegExp(`DELETE FROM (?:public\\.|private\\.)${table}`));
  assert.match(migration, /fintrack-privacy-retention/u);
  assert.match(migration, /BEFORE DELETE ON auth\.users/u);
});
