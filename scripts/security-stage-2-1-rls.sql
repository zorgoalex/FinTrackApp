-- Stage 2.1 defensive RLS/IDOR runner.
-- All fixtures and writes are transaction-scoped and are always rolled back.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(23);

INSERT INTO auth.users (id, email) VALUES
  ('14000000-0000-0000-0000-000000000001', 'stage21-owner@example.invalid'),
  ('14000000-0000-0000-0000-000000000002', 'stage21-member@example.invalid'),
  ('14000000-0000-0000-0000-000000000003', 'stage21-viewer@example.invalid'),
  ('14000000-0000-0000-0000-000000000004', 'stage21-outsider@example.invalid');

INSERT INTO public.workspaces (id, owner_id, name, is_personal, workspace_type) VALUES
  ('24000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000001', 'Security E2E stage 2.1', false, 'personal'),
  ('24000000-0000-0000-0000-000000000002', '14000000-0000-0000-0000-000000000001', 'Security E2E owner-only', false, 'personal');

INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  ('24000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000001', 'Owner'),
  ('24000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000002', 'Member'),
  ('24000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000003', 'Viewer'),
  ('24000000-0000-0000-0000-000000000002', '14000000-0000-0000-0000-000000000001', 'Owner');

INSERT INTO public.operations (
  id, workspace_id, user_id, amount, type, description, operation_date,
  account_id, currency, exchange_rate, base_amount
) VALUES
  (
    '34000000-0000-0000-0000-000000000001',
    '24000000-0000-0000-0000-000000000001',
    '14000000-0000-0000-0000-000000000001',
    10, 'expense', 'Security E2E target operation', CURRENT_DATE,
    (SELECT id FROM public.accounts WHERE workspace_id = '24000000-0000-0000-0000-000000000001' AND is_default),
    'KZT', 1, 10
  ),
  (
    '34000000-0000-0000-0000-000000000002',
    '24000000-0000-0000-0000-000000000002',
    '14000000-0000-0000-0000-000000000001',
    20, 'expense', 'Security E2E owner-only operation', CURRENT_DATE,
    (SELECT id FROM public.accounts WHERE workspace_id = '24000000-0000-0000-0000-000000000002' AND is_default),
    'KZT', 1, 20
  );

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '14000000-0000-0000-0000-000000000001', true);
SELECT is((SELECT count(*)::integer FROM public.workspaces WHERE id = '24000000-0000-0000-0000-000000000001'), 1, 'owner can read Security E2E');
SELECT is((SELECT count(*)::integer FROM public.workspaces WHERE id = '24000000-0000-0000-0000-000000000002'), 1, 'owner can read owner-only workspace');

SELECT set_config('request.jwt.claim.sub', '14000000-0000-0000-0000-000000000002', true);
SELECT is((SELECT count(*)::integer FROM public.workspaces WHERE id = '24000000-0000-0000-0000-000000000001'), 1, 'member can read Security E2E');
SELECT is((SELECT count(*)::integer FROM public.workspaces WHERE id = '24000000-0000-0000-0000-000000000002'), 0, 'member cannot read owner-only workspace');
SELECT is((SELECT count(*)::integer FROM public.operations WHERE id = '34000000-0000-0000-0000-000000000001'), 1, 'member can read target operation');
SELECT is((SELECT count(*)::integer FROM public.operations WHERE id = '34000000-0000-0000-0000-000000000002'), 0, 'member cannot read owner-only operation');
SELECT is_empty(
  $$SELECT id FROM public.operations
    WHERE workspace_id = '24000000-0000-0000-0000-000000000001'
      AND id = '34000000-0000-0000-0000-000000000002'$$,
  'compound IDOR filter cannot cross workspace boundary'
);
SELECT lives_ok(
  $$INSERT INTO public.operations (
      workspace_id, user_id, amount, type, description, operation_date,
      account_id, currency, exchange_rate, base_amount
    ) VALUES (
      '24000000-0000-0000-0000-000000000001',
      '14000000-0000-0000-0000-000000000002',
      1, 'expense', 'Security E2E member write', CURRENT_DATE,
      (SELECT id FROM public.accounts WHERE workspace_id = '24000000-0000-0000-0000-000000000001' AND is_default),
      'KZT', 1, 1
    )$$,
  'member can write inside assigned workspace'
);
SELECT throws_ok(
  $$INSERT INTO public.operations (
      workspace_id, user_id, amount, type, description, operation_date,
      account_id, currency, exchange_rate, base_amount
    ) VALUES (
      '24000000-0000-0000-0000-000000000002',
      '14000000-0000-0000-0000-000000000002',
      1, 'expense', 'Security E2E forbidden member write', CURRENT_DATE,
      (SELECT id FROM public.accounts WHERE workspace_id = '24000000-0000-0000-0000-000000000002' AND is_default),
      'KZT', 1, 1
    )$$,
  '42501', NULL, 'member cannot insert into owner-only workspace'
);
SELECT throws_ok(
  $$UPDATE public.workspace_members SET role = 'Owner'
    WHERE workspace_id = '24000000-0000-0000-0000-000000000001'
      AND user_id = '14000000-0000-0000-0000-000000000002'$$,
  'P0001', 'Участник не может изменить собственную роль или восстановить доступ',
  'member cannot promote self'
);
SELECT is_empty(
  $$UPDATE public.workspace_members SET role = 'Admin'
    WHERE workspace_id = '24000000-0000-0000-0000-000000000001'
      AND user_id = '14000000-0000-0000-0000-000000000003'
    RETURNING user_id$$,
  'member cannot change another membership'
);
SELECT throws_ok(
  $$SELECT public.create_operation_idempotent(
      '64000000-0000-4000-8000-000000000001',
      '24000000-0000-0000-0000-000000000002', 1, 'expense',
      'Security E2E forbidden RPC', CURRENT_DATE, NULL, NULL,
      (SELECT id FROM public.accounts WHERE workspace_id = '24000000-0000-0000-0000-000000000002' AND is_default),
      'KZT', 1, 1, NULL, NULL, '[]', ARRAY[]::text[]
    )$$,
  'P0001', NULL, 'SECURITY DEFINER RPC rejects foreign workspace'
);

SELECT set_config('request.jwt.claim.sub', '14000000-0000-0000-0000-000000000003', true);
SELECT is((SELECT count(*)::integer FROM public.workspaces WHERE id = '24000000-0000-0000-0000-000000000001'), 1, 'viewer can read Security E2E');
SELECT is((SELECT count(*)::integer FROM public.operations WHERE id = '34000000-0000-0000-0000-000000000001'), 1, 'viewer can read target operation');
SELECT throws_ok(
  $$INSERT INTO public.operations (
      workspace_id, user_id, amount, type, description, operation_date,
      account_id, currency, exchange_rate, base_amount
    ) VALUES (
      '24000000-0000-0000-0000-000000000001',
      '14000000-0000-0000-0000-000000000003',
      1, 'expense', 'Security E2E forbidden viewer write', CURRENT_DATE,
      (SELECT id FROM public.accounts WHERE workspace_id = '24000000-0000-0000-0000-000000000001' AND is_default),
      'KZT', 1, 1
    )$$,
  '42501', NULL, 'viewer cannot insert operation'
);
SELECT is_empty(
  $$UPDATE public.operations SET description = 'Security E2E viewer tamper'
    WHERE id = '34000000-0000-0000-0000-000000000001'
    RETURNING id$$,
  'viewer cannot update operation'
);

SELECT set_config('request.jwt.claim.sub', '14000000-0000-0000-0000-000000000004', true);
SELECT is((SELECT count(*)::integer FROM public.workspaces WHERE id = '24000000-0000-0000-0000-000000000001'), 0, 'outsider cannot read Security E2E');
SELECT is((SELECT count(*)::integer FROM public.operations WHERE id = '34000000-0000-0000-0000-000000000001'), 0, 'outsider cannot read target operation');
SELECT is((SELECT count(*)::integer FROM public.workspace_members WHERE workspace_id = '24000000-0000-0000-0000-000000000001'), 0, 'outsider cannot enumerate members');
SELECT throws_ok(
  $$INSERT INTO public.operations (
      workspace_id, user_id, amount, type, description, operation_date,
      account_id, currency, exchange_rate, base_amount
    ) VALUES (
      '24000000-0000-0000-0000-000000000001',
      '14000000-0000-0000-0000-000000000004',
      1, 'expense', 'Security E2E forbidden outsider write', CURRENT_DATE,
      NULL, 'KZT', 1, 1
    )$$,
  '42501', NULL, 'outsider cannot insert operation'
);
SELECT ok(NOT has_schema_privilege('authenticated', 'private', 'USAGE'), 'authenticated cannot use private security schema');
SELECT is((SELECT count(*)::integer FROM public.workspace_invitations WHERE workspace_id = '24000000-0000-0000-0000-000000000001'), 0, 'outsider cannot enumerate invitations');

RESET ROLE;
SELECT is(
  (SELECT item_count FROM private.workspace_resource_usage
   WHERE workspace_id = '24000000-0000-0000-0000-000000000001' AND resource = 'operations'),
  (SELECT count(*)::bigint FROM public.operations WHERE workspace_id = '24000000-0000-0000-0000-000000000001'),
  'quota counter still matches physical rows after denied writes'
);

CREATE TEMP TABLE pg_temp.stage21_finish (line text) ON COMMIT DROP;
INSERT INTO pg_temp.stage21_finish(line) SELECT * FROM finish();
SELECT line FROM pg_temp.stage21_finish;
DO $stage21_finish$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_temp.stage21_finish WHERE line LIKE '# Failed test%') THEN
    RAISE EXCEPTION 'Stage 2.1 pgTAP assertions failed';
  END IF;
END
$stage21_finish$;
ROLLBACK;

SELECT true AS stage21_passed, 23 AS assertions, true AS fixture_rolled_back;
