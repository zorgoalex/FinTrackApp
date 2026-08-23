import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { createIdempotencyTracker, stableRequestKey } from '../src/utils/idempotency.js';

test('stable request keys ignore object key order but preserve array order', () => {
  assert.equal(
    stableRequestKey('operation', { amount: 10, nested: { b: 2, a: 1 } }),
    stableRequestKey('operation', { nested: { a: 1, b: 2 }, amount: 10 }),
  );
  assert.notEqual(
    stableRequestKey('operation', { tags: ['a', 'b'] }),
    stableRequestKey('operation', { tags: ['b', 'a'] }),
  );
});

test('tracker reuses failed logical request and rotates after success or payload change', () => {
  let sequence = 0;
  const tracker = createIdempotencyTracker(() => `request-${++sequence}`);
  const first = tracker.acquire('operation', { amount: 10, description: 'Coffee' });
  const retry = tracker.acquire('operation', { description: 'Coffee', amount: 10 });
  const changed = tracker.acquire('operation', { amount: 11, description: 'Coffee' });

  assert.equal(retry.requestId, first.requestId);
  assert.notEqual(changed.requestId, first.requestId);

  tracker.complete(first.key);
  const intentionalDuplicate = tracker.acquire('operation', { amount: 10, description: 'Coffee' });
  assert.notEqual(intentionalDuplicate.requestId, first.requestId);

  tracker.clear();
  const afterReset = tracker.acquire('operation', { amount: 11, description: 'Coffee' });
  assert.notEqual(afterReset.requestId, changed.requestId);
});


const readProjectFile = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('financial write entrypoints are wired to database idempotency and quota contracts', async () => {
  const [operationsHook, importModal, api, cors, migration] = await Promise.all([
    readProjectFile('src/hooks/useOperations.js'),
    readProjectFile('src/components/ImportOperationsModal.jsx'),
    readProjectFile('supabase/functions/api/index.ts'),
    readProjectFile('supabase/functions/_shared/cors.js'),
    readProjectFile('supabase/migrations/20260823010000_financial_idempotency_workspace_quotas.sql'),
  ]);

  assert.match(operationsHook, /create_operation_idempotent/);
  assert.match(operationsHook, /create_transfer_idempotent/);
  assert.match(operationsHook, /create_transfer_v2_idempotent/);
  assert.match(importModal, /confirm_import_idempotent/);

  assert.match(api, /Idempotency-Key must be a UUID/);
  assert.match(api, /create_operation_idempotent/);
  assert.match(api, /create_transfer_idempotent/);
  assert.match(cors, /idempotency-key/);

  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /CREATE TABLE private\.financial_write_requests/);
  assert.match(migration, /CREATE TABLE private\.workspace_resource_usage/);
  assert.match(migration, /CREATE TRIGGER quota_operations AFTER INSERT OR DELETE/);
  assert.match(migration, /CREATE TRIGGER quota_import_sessions AFTER INSERT OR DELETE/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.confirm_import_idempotent/);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.create_operation_idempotent[\s\S]+TO authenticated/,
  );
  assert.doesNotMatch(
    migration,
    /GRANT .*private\.financial_write_requests.*authenticated/,
  );
});
