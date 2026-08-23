import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import { PRIVACY_EXPORT_FORMAT, PRIVACY_EXPORT_VERSION, privacyExportFilename } from '../src/utils/privacyExport.js';

test('privacy export uses a stable format and date-only safe filename', () => {
  assert.equal(PRIVACY_EXPORT_FORMAT, 'fintrack-account-privacy-export');
  assert.equal(PRIVACY_EXPORT_VERSION, 1);
  assert.equal(privacyExportFilename(new Date('2026-08-23T23:59:59Z')), 'fintrack_my_data_2026-08-23.json');
});

test('privacy export Edge Function is password-gated, RLS-scoped, bounded and not cached', async () => {
  const source = await readFile(new URL('../supabase/functions/privacy-export/index.ts', import.meta.url), 'utf8');
  assert.match(source, /userClient\.rpc\('authorize_my_privacy_export'\)/);
  assert.match(source, /buildExport\(userClient, authData\.user\)/);
  assert.doesNotMatch(source, /admin\s*\.from\(/);
  assert.match(source, /MAX_TOTAL_ROWS = 100_000/);
  assert.match(source, /MAX_EXPORT_BYTES = 32 \* 1024 \* 1024/);
  assert.match(source, /consumeRateLimit\(admin, 'privacy-export:user'/);
  assert.match(source, /EXPORTS_PER_DAY = 3/);
  assert.match(source, /eventType: 'data\.export\.account'/);
  assert.match(source, /'Cache-Control': 'no-store, max-age=0'/);
  assert.match(source, /'Content-Type': 'application\/octet-stream'/);
  assert.match(source, /'Content-Disposition'/);
  assert.match(source, /'push_subscriptions',[\s\S]*'id,workspace_id,user_agent,last_seen_at,created_at,updated_at'/);
  assert.match(source, /'workspace_invitations',[\s\S]*'id,workspace_id,invited_email,role,status,invited_at,expires_at,accepted_at,declined_at,created_at,updated_at,email_sent_at,email_sent_count,last_reminded_at'/);
});

test('privacy export SQL exposes only a fresh-password authorization and redacted event projection', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20260823030000_secure_account_privacy_export.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /current_session_has_fresh_password\(\)/);
  assert.match(migration, /FROM private\.security_events AS event/);
  assert.match(migration, /event\.actor_user_id = auth\.uid\(\)/);
  assert.match(migration, /event\.target_user_id = auth\.uid\(\)/);
  assert.match(migration, /LIMIT 1000/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_my_privacy_security_events\(\)[\s\S]*service_role/);
});

test('profile UI requires fresh password and production smoke covers privacy export CORS', async () => {
  const [profile, auth, config, smoke, legal] = await Promise.all([
    readFile(new URL('../src/pages/ProfilePage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/contexts/AuthContext.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/production-security-smoke.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/LegalPage.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(profile, /requireFreshPassword\([\s\S]*Скачивание полного экспорта[\s\S]*\{ force: true \}/);
  assert.match(auth, /if \(!force\)[\s\S]*hasFreshPassword\(assurance\)/);
  assert.match(profile, /downloadMyPrivacyExport\(supabase\)/);
  assert.match(profile, /Скачать мои данные/);
  assert.match(config, /\[functions\.privacy-export\]\s+verify_jwt = true/);
  assert.match(smoke, /'privacy-export'/);
  assert.match(legal, /Файл формируется по запросу и не сохраняется на сервере/);
});

test('authenticated navigation stays mounted and optional TOTP refresh is non-blocking', async () => {
  const [app, workspace, gate] = await Promise.all([
    readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/contexts/WorkspaceContext.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/OptionalMfaGate.jsx', import.meta.url), 'utf8'),
  ]);

  assert.equal((app.match(/element: protectedLayoutWithWorkspace/g) || []).length, 1);
  assert.match(app, /element: protectedLayoutWithWorkspace,[\s\S]*path: '\/operations'[\s\S]*path: '\/profile'/);
  assert.match(workspace, /const workspaceIdFromPath = pathname\.match/);
  assert.doesNotMatch(gate, /useLocation/);
  assert.match(gate, /refresh\(\{ blocking: true \}\)/);
  assert.match(gate, /const refreshInBackground = \(\) => refresh\(\)/);
  assert.doesNotMatch(gate, /window\.addEventListener\('focus', refresh\)/);
});
