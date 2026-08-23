BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;

SELECT plan(40);

INSERT INTO auth.users (id, email) VALUES
  ('13000000-0000-0000-0000-000000000001', 'integrity-owner@example.test'),
  ('13000000-0000-0000-0000-000000000002', 'integrity-viewer@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspaces (id, owner_id, name, is_personal, workspace_type) VALUES
  ('23000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', 'Financial integrity workspace', false, 'personal');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  ('23000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', 'Owner'),
  ('23000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000002', 'Viewer');

SELECT has_table('private', 'financial_write_requests', 'private financial write receipts exist');
SELECT has_table('private', 'workspace_resource_limits', 'private workspace quota limits exist');
SELECT has_table('private', 'workspace_resource_usage', 'private workspace quota usage exists');
SELECT has_function('public', 'create_operation_idempotent', ARRAY[
  'uuid','uuid','numeric','text','text','date','uuid','uuid','uuid','text','numeric','numeric','uuid','numeric','jsonb','text[]'
], 'idempotent operation RPC exists');
SELECT has_function('public', 'create_transfer_idempotent', ARRAY[
  'uuid','uuid','uuid','uuid','uuid','numeric','text','date','text[]'
], 'idempotent transfer RPC exists');
SELECT has_function('public', 'create_transfer_v2_idempotent', ARRAY[
  'uuid','uuid','uuid','uuid','uuid','numeric','numeric','text','text','numeric','text','date','text[]'
], 'idempotent cross-currency transfer RPC exists');
SELECT has_function('public', 'confirm_import_idempotent', ARRAY[
  'uuid','text','text','text','jsonb','uuid','jsonb','uuid'
], 'payload-bound import RPC exists');
SELECT has_trigger('public', 'operations', 'quota_operations', 'operations have a database quota trigger');
SELECT has_trigger('public', 'accounts', 'quota_accounts', 'accounts have a database quota trigger');
SELECT ok(NOT has_schema_privilege('authenticated', 'private', 'USAGE'), 'authenticated cannot inspect private counters or receipts');
SELECT is(
  (SELECT max_items FROM private.workspace_resource_limits WHERE resource = 'operations'),
  50000::bigint, 'free beta operation quota is explicit'
);
SELECT is(
  (SELECT item_count FROM private.workspace_resource_usage
   WHERE workspace_id = '23000000-0000-0000-0000-000000000001' AND resource = 'accounts'),
  1::bigint, 'default account is included in the initial atomic counter'
);
INSERT INTO private.financial_write_requests(
  workspace_id, user_id, request_id, request_kind, payload_hash, result, created_at, expires_at
) VALUES (
  '23000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001',
  '63000000-0000-4000-8000-000000000099', 'operation', repeat('f', 64), '{}',
  now() - interval '8 days', now() - interval '1 day'
);


SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000001', true);

SELECT lives_ok($$SELECT public.create_operation_idempotent(
  '63000000-0000-4000-8000-000000000001',
  '23000000-0000-0000-0000-000000000001', 25, 'expense', 'Idempotent coffee', CURRENT_DATE,
  NULL, NULL,
  (SELECT id FROM public.accounts WHERE workspace_id = '23000000-0000-0000-0000-000000000001' AND is_default),
  'KZT', 1, 25, NULL, NULL, '[]', ARRAY['integrity']
)$$, 'first operation request succeeds');
RESET ROLE;
SELECT is(
  (SELECT count(*)::integer FROM private.financial_write_requests
   WHERE request_id = '63000000-0000-4000-8000-000000000099'),
  0, 'a bounded cleanup removes expired receipts during the next write'
);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.create_operation_idempotent(
  '63000000-0000-4000-8000-000000000001',
  '23000000-0000-0000-0000-000000000001', 25, 'expense', 'Idempotent coffee', CURRENT_DATE,
  NULL, NULL,
  (SELECT id FROM public.accounts WHERE workspace_id = '23000000-0000-0000-0000-000000000001' AND is_default),
  'KZT', 1, 25, NULL, NULL, '[]', ARRAY['integrity']
)$$, 'same operation request returns its stored result');
SELECT is(
  (SELECT count(*)::integer FROM public.operations
   WHERE workspace_id = '23000000-0000-0000-0000-000000000001' AND description = 'Idempotent coffee'),
  1, 'operation retry creates exactly one row'
);
SELECT is(
  (SELECT count(*)::integer FROM public.operation_tags operation_tag
   JOIN public.operations operation ON operation.id = operation_tag.operation_id
   JOIN public.tags tag ON tag.id = operation_tag.tag_id
   WHERE operation.description = 'Idempotent coffee' AND tag.name = 'integrity'),
  1, 'operation and its tags are committed atomically once'
);
SELECT throws_ok($$SELECT public.create_operation_idempotent(
  '63000000-0000-4000-8000-000000000001',
  '23000000-0000-0000-0000-000000000001', 26, 'expense', 'Changed payload', CURRENT_DATE,
  NULL, NULL,
  (SELECT id FROM public.accounts WHERE workspace_id = '23000000-0000-0000-0000-000000000001' AND is_default),
  'KZT', 1, 26, NULL, NULL, '[]', ARRAY['integrity']
)$$, 'P0001', 'Идентификатор запроса уже использован с другими данными',
  'same request id cannot be rebound to another operation payload');

INSERT INTO public.accounts(workspace_id, name, currency, color)
VALUES ('23000000-0000-0000-0000-000000000001', 'Transfer target', 'KZT', '#6B7280');
SELECT lives_ok($$SELECT public.create_transfer_idempotent(
  '63000000-0000-4000-8000-000000000002',
  '23000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.accounts WHERE workspace_id = '23000000-0000-0000-0000-000000000001' AND is_default),
  (SELECT id FROM public.accounts WHERE workspace_id = '23000000-0000-0000-0000-000000000001' AND name = 'Transfer target'),
  10, 'Idempotent transfer', CURRENT_DATE, ARRAY['transfer-integrity']
)$$, 'first transfer request succeeds atomically');
SELECT lives_ok($$SELECT public.create_transfer_idempotent(
  '63000000-0000-4000-8000-000000000002',
  '23000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.accounts WHERE workspace_id = '23000000-0000-0000-0000-000000000001' AND is_default),
  (SELECT id FROM public.accounts WHERE workspace_id = '23000000-0000-0000-0000-000000000001' AND name = 'Transfer target'),
  10, 'Idempotent transfer', CURRENT_DATE, ARRAY['transfer-integrity']
)$$, 'transfer retry returns the same pair');
SELECT is(
  (SELECT count(*)::integer FROM public.operations
   WHERE workspace_id = '23000000-0000-0000-0000-000000000001' AND description = 'Idempotent transfer'),
  2, 'transfer retry does not create another pair'
);
SELECT is(
  (SELECT count(*)::integer FROM public.operation_tags operation_tag
   JOIN public.operations operation ON operation.id = operation_tag.operation_id
   JOIN public.tags tag ON tag.id = operation_tag.tag_id
   WHERE operation.description = 'Idempotent transfer' AND tag.name = 'transfer-integrity'),
  2, 'both transfer operations receive tags in the same transaction'
);

SELECT lives_ok($$SELECT public.confirm_import_idempotent(
  '23000000-0000-0000-0000-000000000001', 'csv', 'csv', repeat('a', 64),
  jsonb_build_array(jsonb_build_object(
    'type', 'expense', 'amount', 15, 'operation_date', CURRENT_DATE,
    'currency', 'KZT', 'exchange_rate', 1, 'base_amount', 15,
    'account_id', (SELECT id FROM public.accounts WHERE workspace_id = '23000000-0000-0000-0000-000000000001' AND is_default),
    'description', 'Idempotent import', 'import_fingerprint', repeat('b', 64)
  )), NULL, '{}', '63000000-0000-4000-8000-000000000003'
)$$, 'first import request succeeds');
SELECT lives_ok($$SELECT public.confirm_import_idempotent(
  '23000000-0000-0000-0000-000000000001', 'csv', 'csv', repeat('a', 64),
  jsonb_build_array(jsonb_build_object(
    'type', 'expense', 'amount', 15, 'operation_date', CURRENT_DATE,
    'currency', 'KZT', 'exchange_rate', 1, 'base_amount', 15,
    'account_id', (SELECT id FROM public.accounts WHERE workspace_id = '23000000-0000-0000-0000-000000000001' AND is_default),
    'description', 'Idempotent import', 'import_fingerprint', repeat('b', 64)
  )), NULL, '{}', '63000000-0000-4000-8000-000000000003'
)$$, 'same import request returns the stored result');
SELECT is(
  (SELECT count(*)::integer FROM public.operations WHERE import_fingerprint = repeat('b', 64)),
  1, 'import retry creates exactly one operation'
);
SELECT throws_ok($$SELECT public.confirm_import_idempotent(
  '23000000-0000-0000-0000-000000000001', 'csv', 'csv', repeat('c', 64),
  jsonb_build_array(jsonb_build_object('selected', false)),
  NULL, '{}', '63000000-0000-4000-8000-000000000003'
)$$, 'P0001', 'Идентификатор запроса уже использован с другими данными',
  'same request id cannot be rebound to another import payload');

RESET ROLE;
UPDATE private.workspace_resource_limits limits
SET max_items = usage.item_count + 1
FROM private.workspace_resource_usage usage
WHERE limits.resource = 'accounts'
  AND usage.workspace_id = '23000000-0000-0000-0000-000000000001'
  AND usage.resource = limits.resource;
SET LOCAL ROLE authenticated;
SELECT lives_ok($$INSERT INTO public.accounts(workspace_id, name, currency, color)
  VALUES ('23000000-0000-0000-0000-000000000001', 'Quota slot', 'KZT', '#6B7280')$$,
  'direct PostgREST-style insert can consume the final account slot');
SELECT throws_ok($$INSERT INTO public.accounts(workspace_id, name, currency, color)
  VALUES ('23000000-0000-0000-0000-000000000001', 'Over quota', 'KZT', '#6B7280')$$,
  'P0001', 'Достигнут лимит beta: счета (3)', 'database rejects a direct insert above quota');
RESET ROLE;
SELECT is(
  (SELECT item_count FROM private.workspace_resource_usage
   WHERE workspace_id = '23000000-0000-0000-0000-000000000001' AND resource = 'accounts'),
  3::bigint, 'failed insert does not corrupt the account counter'
);
SET LOCAL ROLE authenticated;
DELETE FROM public.accounts
WHERE workspace_id = '23000000-0000-0000-0000-000000000001' AND name = 'Quota slot';
SELECT lives_ok($$INSERT INTO public.accounts(workspace_id, name, currency, color)
  VALUES ('23000000-0000-0000-0000-000000000001', 'Reused quota slot', 'KZT', '#6B7280')$$,
  'delete transactionally releases one quota slot');
RESET ROLE;
SELECT is(
  (SELECT item_count FROM private.workspace_resource_usage
   WHERE workspace_id = '23000000-0000-0000-0000-000000000001' AND resource = 'accounts'),
  3::bigint, 'released account slot is counted exactly once'
);

RESET ROLE;
UPDATE private.workspace_resource_limits limits
SET max_items = usage.item_count + 1
FROM private.workspace_resource_usage usage
WHERE limits.resource = 'operations'
  AND usage.workspace_id = '23000000-0000-0000-0000-000000000001'
  AND usage.resource = limits.resource;
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.create_transfer_idempotent(
  '63000000-0000-4000-8000-000000000004',
  '23000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.accounts WHERE workspace_id = '23000000-0000-0000-0000-000000000001' AND is_default),
  (SELECT id FROM public.accounts WHERE workspace_id = '23000000-0000-0000-0000-000000000001' AND name = 'Transfer target'),
  11, 'Over quota transfer', CURRENT_DATE, '{}'
)$$, 'P0001', NULL, 'two-row transfer rolls back when only one operation slot remains');
SELECT is(
  (SELECT count(*)::integer FROM public.operations
   WHERE workspace_id = '23000000-0000-0000-0000-000000000001' AND description = 'Over quota transfer'),
  0, 'failed transfer leaves no half-created operation'
);
RESET ROLE;
SELECT is(
  (SELECT count(*)::integer FROM private.financial_write_requests
   WHERE user_id = '13000000-0000-0000-0000-000000000001'
     AND request_id = '63000000-0000-4000-8000-000000000004'),
  0, 'failed transfer leaves no idempotency receipt'
);

UPDATE private.workspace_resource_limits limits
SET max_items = usage.item_count
FROM private.workspace_resource_usage usage
WHERE limits.resource = 'operations'
  AND usage.workspace_id = '23000000-0000-0000-0000-000000000001'
  AND usage.resource = limits.resource;
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.confirm_import_idempotent(
  '23000000-0000-0000-0000-000000000001', 'csv', 'csv', repeat('d', 64),
  jsonb_build_array(jsonb_build_object(
    'type', 'expense', 'amount', 20, 'operation_date', CURRENT_DATE,
    'currency', 'KZT', 'exchange_rate', 1, 'base_amount', 20,
    'account_id', (SELECT id FROM public.accounts WHERE workspace_id = '23000000-0000-0000-0000-000000000001' AND is_default),
    'description', 'Over quota import', 'import_fingerprint', repeat('e', 64)
  )), NULL, '{}', '63000000-0000-4000-8000-000000000005'
)$$, 'P0001', NULL, 'import rolls back atomically when operation quota is full');
SELECT is(
  (SELECT count(*)::integer FROM public.import_sessions
   WHERE request_id = '63000000-0000-4000-8000-000000000005'),
  0, 'failed import leaves no audit session'
);
SELECT is(
  (SELECT count(*)::integer FROM public.operations WHERE import_fingerprint = repeat('e', 64)),
  0, 'failed import leaves no operation'
);
SELECT throws_ok($$INSERT INTO public.operations(
    workspace_id, user_id, amount, type, description, operation_date,
    account_id, currency, exchange_rate, base_amount
  ) VALUES (
    '23000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001',
    1, 'expense', 'Direct over quota', CURRENT_DATE,
    (SELECT id FROM public.accounts WHERE workspace_id = '23000000-0000-0000-0000-000000000001' AND is_default),
    'KZT', 1, 1
  )$$, 'P0001', NULL, 'direct PostgREST operation insert cannot bypass quota');

RESET ROLE;
SELECT is(
  (SELECT item_count FROM private.workspace_resource_usage
   WHERE workspace_id = '23000000-0000-0000-0000-000000000001' AND resource = 'operations'),
  (SELECT count(*)::bigint FROM public.operations
   WHERE workspace_id = '23000000-0000-0000-0000-000000000001'),
  'atomic operation counter matches physical rows after all failed writes'
);
SELECT is(
  (SELECT count(*)::integer FROM private.financial_write_requests
   WHERE workspace_id = '23000000-0000-0000-0000-000000000001'),
  3, 'only successful operation, transfer and import receipts are stored'
);

SELECT * FROM finish();
ROLLBACK;
