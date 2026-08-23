import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_REQUESTS,
  PRODUCTION_API_ORIGIN,
  PRODUCTION_CONFIRMATION,
  validateTargetConfig,
} from '../scripts/security-stage-2-1-http.mjs';
import { parseSupabaseEnv, summarizeSqlOutput } from '../scripts/run-security-stage-2-1.mjs';

const uuid = (suffix) => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;

test('Stage 2.1 local target refuses remote hosts', () => {
  assert.equal(validateTargetConfig({ mode: 'local', apiUrl: 'http://127.0.0.1:54321' }).apiUrl, 'http://127.0.0.1:54321');
  assert.throws(() => validateTargetConfig({ mode: 'local', apiUrl: PRODUCTION_API_ORIGIN }), /refuses a non-local API host/);
});

test('Stage 2.1 production target is fail-closed', () => {
  const valid = {
    mode: 'production', apiUrl: PRODUCTION_API_ORIGIN, confirmation: PRODUCTION_CONFIRMATION,
    workspaceLabel: 'Security E2E', workspaceId: uuid(1), foreignWorkspaceId: uuid(2),
    targetOperationId: uuid(3), foreignOperationId: uuid(4),
  };
  assert.equal(validateTargetConfig(valid).apiUrl, PRODUCTION_API_ORIGIN);
  assert.throws(() => validateTargetConfig({ ...valid, apiUrl: 'https://example.test' }), /unexpected Supabase project/);
  assert.throws(() => validateTargetConfig({ ...valid, confirmation: 'yes' }), /confirmation is missing/);
  assert.throws(() => validateTargetConfig({ ...valid, workspaceLabel: 'Personal' }), /must be exactly Security E2E/);
  assert.throws(() => validateTargetConfig({ ...valid, targetOperationId: '' }), /target operation UUID is required/);
  assert.throws(() => validateTargetConfig({ ...valid, foreignWorkspaceId: valid.workspaceId }), /must differ/);
});

test('Stage 2.1 request ceiling remains conservative', () => {
  assert.equal(MAX_REQUESTS, 48);
});

test('Supabase env parser handles quoted values without logging them', () => {
  assert.deepEqual(parseSupabaseEnv('API_URL="http://127.0.0.1:54321"\nANON_KEY="secret-value"\nnoise\n'), {
    API_URL: 'http://127.0.0.1:54321', ANON_KEY: 'secret-value',
  });
});

test('SQL TAP summary rejects pgTAP failures even with exit code zero', () => {
  assert.deepEqual(summarizeSqlOutput({ status: 0, stdout: '1..2\nok 1 - allowed\nnot ok 2 - denied\n# Failed test 2', stderr: '' }), {
    passed: false, planned: 2, ok: 1, notOk: 1, exitCode: 0,
    failure: ['not ok 2 - denied', '# Failed test 2'],
  });
});

test('SQL TAP summary accepts a complete passing plan', () => {
  assert.equal(summarizeSqlOutput({ status: 0, stdout: '1..2\nok 1 - first\nok 2 - second', stderr: '' }).passed, true);
});
