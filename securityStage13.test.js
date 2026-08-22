/* global Headers, Response */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  BROWSER_FUNCTIONS,
  DEFAULT_APP_URL,
  DEFAULT_FUNCTIONS_URL,
  runProductionSecuritySmoke,
} from './scripts/production-security-smoke.mjs';

function productionFetch({ includeHsts = true } = {}) {
  return async (url, options = {}) => {
    if (url === `${DEFAULT_APP_URL}/`) {
      const headers = new Headers({
        'Content-Security-Policy': "default-src 'self'; connect-src 'self' https://trpfmcggvixnfmcgvxsq.supabase.co wss://trpfmcggvixnfmcgvxsq.supabase.co",
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      });
      if (includeHsts) headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      return new Response('ok', { status: 200, headers });
    }
    if (url === `${DEFAULT_APP_URL}/.well-known/security.txt`) {
      return new Response(
        `Contact: mailto:support@fintrackapp.vip\nCanonical: ${DEFAULT_APP_URL}/.well-known/security.txt`,
        { status: 200 },
      );
    }
    if (url.startsWith(DEFAULT_FUNCTIONS_URL)) {
      const origin = options.headers?.Origin;
      return new Response(null, {
        status: origin === DEFAULT_APP_URL ? 204 : 403,
        headers: origin === DEFAULT_APP_URL ? { 'Access-Control-Allow-Origin': origin } : {},
      });
    }
    return new Response('not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  };
}

test('production monitor checks the complete browser perimeter', async () => {
  const result = await runProductionSecuritySmoke({ fetchImpl: productionFetch() });
  assert.equal(result.checkedFunctions, BROWSER_FUNCTIONS.length);
  assert.equal(BROWSER_FUNCTIONS.includes('security-event'), true);
});

test('production monitor fails when a required security header disappears', async () => {
  await assert.rejects(
    runProductionSecuritySmoke({ fetchImpl: productionFetch({ includeHsts: false }) }),
    /HSTS is missing/,
  );
});

test('security events use server-side HMAC subjects and a private database sink', async () => {
  const rateLimit = await readFile('supabase/functions/_shared/rateLimit.ts', 'utf8');
  const helper = await readFile('supabase/functions/_shared/securityEvents.ts', 'utf8');
  const migration = await readFile('supabase/migrations/20260822010000_security_event_audit.sql', 'utf8');

  assert.match(rateLimit, /HMAC/);
  assert.match(rateLimit, /SHA-256/);
  assert.match(rateLimit, /RATE_LIMIT_SALT/);
  assert.doesNotMatch(rateLimit, /return value\.trim\(\)\.toLowerCase\(\);/);
  assert.match(helper, /record_security_event/);
  assert.doesNotMatch(helper, /console\.error\([^\n]*(?:password|token|secret|authorization)/i);
  assert.match(migration, /CREATE TABLE private\.security_events/);
  assert.match(migration, /REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration, /interval '90 days'/);
  assert.match(migration, /password\|token\|secret\|authorization\|captcha\|cookie\|email\|ip\|credential/);
});

test('authoritative actions and user exports are covered by the audit trail', async () => {
  const migration = await readFile('supabase/migrations/20260822010000_security_event_audit.sql', 'utf8');
  const operations = await readFile('src/pages/OperationPage.jsx', 'utf8');
  const analytics = await readFile('src/pages/AnalyticsPage.jsx', 'utf8');
  const settings = await readFile('src/pages/WorkspaceSettingsPage.jsx', 'utf8');

  for (const eventType of [
    'workspace.role_change',
    'workspace.member_remove',
    'workspace.delete',
    'invitation.cancel',
    'workspace.restore',
    'account.delete',
  ]) {
    assert.ok(migration.includes(eventType), eventType);
  }

  assert.match(operations, /data\.export\.operations/);
  assert.match(analytics, /data\.export\.analytics/);
  assert.match(settings, /workspace\.backup_download/);
});

test('scheduled monitor uses immutable actions and an optional free alert channel', async () => {
  const workflow = await readFile('.github/workflows/production-security-monitor.yml', 'utf8');
  const alert = await readFile('scripts/send-security-monitor-alert.mjs', 'utf8');
  const uses = [...workflow.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1]);

  assert.match(workflow, /cron: '17 \*\/6 \* \* \*'/);
  assert.ok(uses.length > 0);
  uses.forEach((action) => assert.match(action, /^[^@\s]+@[0-9a-f]{40}$/));
  assert.match(workflow, /if: failure\(\)/);
  assert.match(alert, /api\.resend\.com\/emails/);
  assert.match(alert, /optional Resend configuration is unavailable/);
});
