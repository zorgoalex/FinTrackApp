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
  const passwordAuth = await readFile('supabase/functions/password-auth/index.ts', 'utf8');
  const profile = await readFile('src/pages/ProfilePage.jsx', 'utf8');
  const migration = await readFile('supabase/migrations/20260804010000_security_stage0.sql', 'utf8');
  assert.match(auth, /currentPassword/);
  assert.match(passwordAuth, /current_password: currentPassword/);
  assert.match(profile, /signInWithPassword/);
  assert.match(profile, /deletePassword/);
  assert.match(migration, /interval '5 minutes'/);
  assert.match(migration, /FROM auth\.sessions/);
});

test('TOTP is optional while role changes and restore require a fresh password', async () => {
  const auth = await readFile('src/contexts/AuthContext.jsx', 'utf8');
  const workspace = await readFile('src/contexts/WorkspaceContext.jsx', 'utf8');
  const profile = await readFile('src/pages/ProfilePage.jsx', 'utf8');
  const operations = await readFile('src/pages/OperationPage.jsx', 'utf8');
  const analytics = await readFile('src/pages/AnalyticsPage.jsx', 'utf8');
  const backup = await readFile('src/pages/WorkspaceSettingsPage.jsx', 'utf8');
  const gate = await readFile('src/components/OptionalMfaGate.jsx', 'utf8');
  const settings = await readFile('src/components/MfaSettings.jsx', 'utf8');
  const api = await readFile('supabase/functions/api/index.ts', 'utf8');
  const migration = await readFile('supabase/migrations/20260811010000_critical_action_password_step_up.sql', 'utf8');

  assert.match(auth, /requireFreshPassword/);
  assert.match(workspace, /Изменение роли участника требует повторного ввода текущего пароля/);
  assert.match(backup, /Восстановление данных требует повторного ввода текущего пароля/);
  assert.match(gate, /state\.factors\.length === 0/);
  assert.doesNotMatch(gate, /current_user_requires_workspace_mfa/);
  assert.match(settings, /Вы можете включить его добровольно/);
  assert.doesNotMatch(profile, /Удаление аккаунта требует свежего кода TOTP/);
  assert.doesNotMatch(operations, /Экспорт операций требует свежего кода TOTP/);
  assert.doesNotMatch(analytics, /Экспорт аналитики требует свежего кода TOTP/);
  assert.doesNotMatch(api, /Fresh TOTP confirmation required/);
  assert.match(migration, /current_session_has_fresh_password/);
  assert.match(migration, /interval '5 minutes'/);
});

test('zero-cost backup encrypts before private R2 upload and enforces a size gate', async () => {
  const workflow = await readFile('.github/workflows/encrypted-backup.yml', 'utf8');
  assert.match(workflow, /pg_dump/);
  assert.match(workflow, /--user "\$\(id -u\):\$\(id -g\)"/);
  assert.match(workflow, /age --recipient/);
  assert.match(workflow, /\.Contents\[\]\?\.Size.*add \/\/ 0/);
  assert.match(workflow, /8 \* 1024 \* 1024 \* 1024/);
  assert.match(workflow, /s3:\/\/\$\{R2_BUCKET\}/);
  assert.match(workflow, /if \[ -n "\$path" \] && \[ -f "\$path" \]; then/);
  assert.doesNotMatch(workflow, /\[ -f "\$path" \] && shred --remove/);
  assert.doesNotMatch(workflow, /upload-artifact/);
});
