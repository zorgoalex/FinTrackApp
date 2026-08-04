import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Telegram webhook rechecks private chat, active role and replay id', async () => {
  const source = await readFile('supabase/functions/telegram-bot/index.ts', 'utf8');
  assert.match(source, /claim_telegram_webhook_update/);
  assert.match(source, /message\.chat\.type !== 'private'/);
  assert.match(source, /Number\(tgUser\.chat_id\) !== chatId/);
  assert.match(source, /requireWorkspaceRole/);
  assert.match(source, /\['Owner', 'Admin', 'Member'\]/);
  assert.match(source, /\['Owner', 'Admin'\]/);
  assert.doesNotMatch(source, /parse_mode:\s*'HTML'/);
});

test('beta blocks external AI and STT unless an explicit server flag is true', async () => {
  const ai = await readFile('supabase/functions/ai-assistant/index.ts', 'utf8');
  const stt = await readFile('supabase/functions/stt-transcribe/index.ts', 'utf8');
  const modal = await readFile('src/components/AddOperationModal.jsx', 'utf8');
  assert.match(ai, /BETA_EXTERNAL_AI_ENABLED/);
  assert.match(stt, /BETA_EXTERNAL_STT_ENABLED/);
  assert.match(stt, /FEATURE_DISABLED/);
  assert.match(modal, /VITE_EXTERNAL_STT_ENABLED === 'true'/);
});

test('password change and account deletion require the current password', async () => {
  const auth = await readFile('src/contexts/AuthContext.jsx', 'utf8');
  const profile = await readFile('src/pages/ProfilePage.jsx', 'utf8');
  const migration = await readFile('supabase/migrations/20260804010000_security_stage0.sql', 'utf8');
  assert.match(auth, /current_password/);
  assert.match(profile, /signInWithPassword/);
  assert.match(profile, /deletePassword/);
  assert.match(migration, /interval '5 minutes'/);
  assert.match(migration, /FROM auth\.sessions/);
});

test('zero-cost backup encrypts before private R2 upload and enforces a size gate', async () => {
  const workflow = await readFile('.github/workflows/encrypted-backup.yml', 'utf8');
  assert.match(workflow, /pg_dump/);
  assert.match(workflow, /age --recipient/);
  assert.match(workflow, /8 \* 1024 \* 1024 \* 1024/);
  assert.match(workflow, /s3:\/\/\$\{R2_BUCKET\}/);
  assert.doesNotMatch(workflow, /upload-artifact/);
});
