import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBrowserEnvironment, parseBrowserArgs, validateLoopbackUrl } from '../scripts/run-security-browser-e2e.mjs';

test('browser security target accepts loopback http only', () => {
  assert.equal(validateLoopbackUrl('http://127.0.0.1:54321/path'), 'http://127.0.0.1:54321');
  assert.equal(validateLoopbackUrl('http://localhost:4173'), 'http://localhost:4173');
  assert.throws(() => validateLoopbackUrl('https://project.supabase.co'), /must use http|loopback/);
  assert.throws(() => validateLoopbackUrl('http://192.168.1.10:54321'), /loopback/);
});

test('browser runner only forwards bounded Playwright arguments', () => {
  assert.deepEqual(parseBrowserArgs(['--grep', '@sequential']), ['--grep', '@sequential']);
  assert.deepEqual(parseBrowserArgs(['--headed', '--grep', '@concurrent']), ['--headed', '--grep', '@concurrent']);
  assert.throws(() => parseBrowserArgs(['--config', 'other.js']), /unsupported/);
  assert.throws(() => parseBrowserArgs(['--grep', 'anything']), /only accepts/);
});

test('browser environment does not accept a remote Supabase target', () => {
  assert.throws(() => buildBrowserEnvironment({
    API_URL: 'https://project.supabase.co',
    ANON_KEY: 'anon',
    SERVICE_ROLE_KEY: 'service',
  }), /must use http|loopback/);
});
