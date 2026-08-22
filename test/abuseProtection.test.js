import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  PayloadTooLargeError,
  UpstreamTimeoutError,
  fetchWithTimeout,
  readJsonWithLimit,
  readResponseTextWithLimit,
} from '../supabase/functions/_shared/abuseProtection.js';

test('bounded JSON reader accepts small bodies and rejects declared or streamed excess', async () => {
  const valid = new globalThis.Request('https://local.test', {
    method: 'POST', body: JSON.stringify({ ok: true }), headers: { 'content-type': 'application/json' }, duplex: 'half',
  });
  assert.deepEqual(await readJsonWithLimit(valid, 128), { ok: true });

  const declared = new globalThis.Request('https://local.test', {
    method: 'POST', body: '{}', headers: { 'content-length': '1024' }, duplex: 'half',
  });
  await assert.rejects(() => readJsonWithLimit(declared, 32), PayloadTooLargeError);

  const streamed = new globalThis.Request('https://local.test', {
    method: 'POST', body: 'x'.repeat(64), duplex: 'half',
  });
  await assert.rejects(() => readJsonWithLimit(streamed, 32), PayloadTooLargeError);
});

test('bounded upstream reader rejects oversized responses', async () => {
  const response = new globalThis.Response('small', { headers: { 'content-length': '1000' } });
  await assert.rejects(() => readResponseTextWithLimit(response, 32), PayloadTooLargeError);
});

test('upstream timeout aborts a stalled request', async () => {
  const stalledFetch = (_input, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  await assert.rejects(
    () => fetchWithTimeout('https://local.test', {}, 20, stalledFetch),
    UpstreamTimeoutError,
  );
});

test('expensive Edge Functions enforce bounded requests, quotas and upstream deadlines', async () => {
  const [api, ai, rates, invite, login, passwordAuth, telegram, stt, notifications, push, securityEvent, rateLimit, pushMigration] = await Promise.all([
    readFile('supabase/functions/api/index.ts', 'utf8'),
    readFile('supabase/functions/ai-assistant/index.ts', 'utf8'),
    readFile('supabase/functions/fetch-rates/index.ts', 'utf8'),
    readFile('supabase/functions/invite-user/index.ts', 'utf8'),
    readFile('supabase/functions/login-user/index.ts', 'utf8'),
    readFile('supabase/functions/password-auth/index.ts', 'utf8'),
    readFile('supabase/functions/telegram-link/index.ts', 'utf8'),
    readFile('supabase/functions/stt-transcribe/index.ts', 'utf8'),
    readFile('supabase/functions/dispatch-notifications/index.ts', 'utf8'),
    readFile('supabase/functions/send-test-push/index.ts', 'utf8'),
    readFile('supabase/functions/security-event/index.ts', 'utf8'),
    readFile('supabase/functions/_shared/rateLimit.ts', 'utf8'),
    readFile('supabase/migrations/20260822020000_abuse_quota_hardening.sql', 'utf8'),
  ]);

  assert.match(api, /MAX_EXPORT_ROWS = 5_000/);
  assert.match(api, /'api:export'/);
  assert.match(api, /readJsonWithLimit\(req, MAX_API_BODY_BYTES\)/);
  assert.match(ai, /fetchWithTimeout\('https:\/\/openrouter\.ai/);
  assert.match(ai, /readResponseJsonWithLimit/);
  assert.match(rates, /PROVIDER_TIMEOUT_MS/);
  assert.match(invite, /EMAIL_TIMEOUT_MS/);
  assert.match(login, /MAX_REQUEST_BYTES = 8 \* 1024/);
  assert.match(ai, /'assistant:global'/);
  assert.match(passwordAuth, /MAX_REQUEST_BYTES = 16 \* 1024/);
  assert.match(telegram, /'telegram-link:user'/);
  assert.match(notifications, /'notifications:dispatch'/);
  assert.match(rates, /consumeRateLimit\(admin, 'rates:workspace'/);
  assert.match(notifications, /MAX_EXTERNAL_DELIVERIES_PER_RUN/);
  assert.match(invite, /'invite:global'/);
  assert.match(push, /\.limit\(5\)/);
  assert.match(invite, /'email:resend:global'/);
  assert.match(push, /timeout: 10_000/);
  assert.match(securityEvent, /MAX_REQUEST_BYTES = 2 \* 1024/);
  assert.match(rateLimit, /\.at\(-1\)/);
  assert.match(rateLimit, /\^\[0-9a-f:\]\+\$/);
  assert.match(stt, /'stt:global'/);
  assert.match(notifications, /current\.length < 5/);
  assert.match(notifications, /dailyDeliveryLimits = \{ telegram: 500, push: 1_000, email: 50 \}/);
  assert.match(notifications, /channel === 'email' \? 'email:resend:global'/);
  assert.match(pushMigration, /pg_advisory_xact_lock/);
  assert.match(pushMigration, />= 5/);
  assert.match(stt, /readFormDataWithLimit/);
});
