/* global Request, Response */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  corsHeadersFor,
  isAllowedBrowserOrigin,
  isAllowedRedirectOrigin,
  withCors,
} from './supabase/functions/_shared/cors.js';

const browserFunctions = [
  'accept-invitation',
  'ai-assistant',
  'api',
  'fetch-rates',
  'invite-user',
  'login-user',
  'password-auth',
  'security-event',
  'send-test-push',
  'stt-transcribe',
  'telegram-link',
];

test('CORS allowlist accepts production origins and rejects hostile browser origins', async () => {
  const productionRequest = new Request('https://project.supabase.co/functions/v1/api', {
    headers: { Origin: 'https://fintrackapp.vip' },
  });
  const aliasRequest = new Request('https://project.supabase.co/functions/v1/api', {
    headers: { Origin: 'https://fintrackapp-wheat.vercel.app' },
  });
  const hostileRequest = new Request('https://project.supabase.co/functions/v1/api', {
    headers: { Origin: 'https://attacker.example' },
  });

  assert.equal(isAllowedBrowserOrigin(productionRequest), true);
  assert.equal(isAllowedBrowserOrigin(aliasRequest), true);
  assert.equal(isAllowedBrowserOrigin(hostileRequest), false);
  assert.equal(corsHeadersFor(productionRequest).get('Access-Control-Allow-Origin'), 'https://fintrackapp.vip');

  let handlerCalled = false;
  const guarded = withCors(() => {
    handlerCalled = true;
    return new Response('ok');
  });
  const response = await guarded(hostileRequest);
  assert.equal(response.status, 403);
  assert.equal(response.headers.has('Access-Control-Allow-Origin'), false);
  assert.equal(handlerCalled, false);
});

test('CORS permits localhost only when the Edge Function itself is local', async () => {
  const localOrigin = { Origin: 'http://localhost:5173' };
  assert.equal(isAllowedBrowserOrigin(new Request('http://127.0.0.1:54321/functions/v1/api', { headers: localOrigin })), true);
  assert.equal(isAllowedBrowserOrigin(new Request('https://project.supabase.co/functions/v1/api', { headers: localOrigin })), false);
  assert.equal(isAllowedRedirectOrigin(
    new Request('http://127.0.0.1:54321/functions/v1/password-auth'),
    'http://localhost:5173',
  ), true);
  assert.equal(isAllowedRedirectOrigin(
    new Request('https://project.supabase.co/functions/v1/password-auth'),
    'http://localhost:5173',
  ), false);
  assert.equal(isAllowedRedirectOrigin(
    new Request('https://project.supabase.co/functions/v1/password-auth'),
    'https://fintrackapp.vip',
  ), true);

  const preflight = await withCors(() => new Response('unexpected'))(new Request(
    'https://project.supabase.co/functions/v1/api',
    { method: 'OPTIONS', headers: { Origin: 'https://fintrackapp.vip' } },
  ));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://fintrackapp.vip');
  assert.equal(preflight.headers.get('Vary'), 'Origin');
});

test('all browser Edge Functions use the shared fail-closed CORS wrapper', async () => {
  for (const functionName of browserFunctions) {
    const source = await readFile(`supabase/functions/${functionName}/index.ts`, 'utf8');
    assert.match(source, /import \{[^}]*withCors[^}]*\} from '\.\.\/_shared\/cors\.ts';/s, functionName);
    assert.match(source, /Deno\.serve\(withCors\(/, functionName);
    assert.doesNotMatch(source, /['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*['"]/, functionName);
  }
});

test('Vercel perimeter rules use narrow connections and real security endpoints', async () => {
  const config = JSON.parse(await readFile('vercel.json', 'utf8'));
  const csp = config.headers[0].headers.find(({ key }) => key === 'Content-Security-Policy')?.value || '';
  assert.match(csp, /connect-src 'self' https:\/\/trpfmcggvixnfmcgvxsq\.supabase\.co wss:\/\/trpfmcggvixnfmcgvxsq\.supabase\.co/);
  assert.doesNotMatch(csp, /connect-src[^;]*(?:\shttps:|\swss:)(?:\s|;)/);

  const rewriteSources = config.rewrites.map(({ source }) => source);
  assert.ok(rewriteSources.indexOf('/.well-known/security.txt') < rewriteSources.indexOf('/(.*)'));
  assert.ok(rewriteSources.indexOf('/.env') < rewriteSources.indexOf('/(.*)'));
  assert.ok(rewriteSources.indexOf('/.git/(.*)') < rewriteSources.indexOf('/(.*)'));
  assert.ok(rewriteSources.indexOf('/(.*).map') < rewriteSources.indexOf('/(.*)'));

  const notFound = await readFile('api/not-found.js', 'utf8');
  const security = await readFile('api/security.js', 'utf8');
  assert.match(notFound, /status\(404\)/);
  assert.match(notFound, /no-store/);
  assert.match(security, /support@fintrackapp\.vip/);
  assert.match(security, /Canonical: https:\/\/fintrackapp\.vip\/\.well-known\/security\.txt/);
});

test('free security CI is pinned to immutable action SHAs', async () => {
  const files = [
    '.github/workflows/quality-gates.yml',
    '.github/workflows/encrypted-backup.yml',
    '.github/workflows/security.yml',
  ];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const uses = [...source.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1]);
    assert.ok(uses.length > 0, file);
    uses.forEach((action) => assert.match(action, /^[^@\s]+@[0-9a-f]{40}$/, `${file}: ${action}`));
  }

  const security = await readFile('.github/workflows/security.yml', 'utf8');
  const quality = await readFile('.github/workflows/quality-gates.yml', 'utf8');
  const dependabot = await readFile('.github/dependabot.yml', 'utf8');
  assert.match(security, /npm audit --audit-level=high/);
  assert.match(security, /gitleaks\/gitleaks-action@/);
  assert.match(security, /github\/codeql-action\/analyze@/);
  assert.match(quality, /version: 2\.111\.0/);
  assert.doesNotMatch(quality, /version: latest/);
  assert.match(dependabot, /package-ecosystem: npm/);
  assert.match(dependabot, /package-ecosystem: github-actions/);
});
