BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(13);

INSERT INTO auth.users(id, email) VALUES
  ('13000000-0000-0000-0000-000000000001', 'split-owner@example.test'),
  ('13000000-0000-0000-0000-000000000002', 'split-member@example.test'),
  ('13000000-0000-0000-0000-000000000003', 'split-viewer@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.workspaces(id, owner_id, name, is_personal, workspace_type)
VALUES ('23000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', 'Split fixture', false, 'business');
INSERT INTO public.workspace_members(workspace_id, user_id, role) VALUES
  ('23000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', 'Owner'),
  ('23000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000002', 'Member'),
  ('23000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000003', 'Viewer');
INSERT INTO public.categories(id, workspace_id, name, type) VALUES
  ('33000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000001', 'Split rent', 'expense'),
  ('33000000-0000-0000-0000-000000000002', '23000000-0000-0000-0000-000000000001', 'Split services', 'expense');

SELECT has_table('public', 'operation_allocations', 'allocation table exists');
SELECT has_function('public', 'create_operation_with_allocations', ARRAY[
  'uuid','numeric','text','text','date','uuid','uuid','uuid','text','numeric','numeric','uuid','numeric','jsonb','text[]'
], 'atomic split create RPC exists');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000002', true);

SELECT lives_ok($$SELECT public.create_operation_with_allocations(
  '23000000-0000-0000-0000-000000000001', 100, 'expense', 'Split operation', CURRENT_DATE,
  NULL, NULL,
  (SELECT id FROM public.accounts WHERE workspace_id='23000000-0000-0000-0000-000000000001' AND is_default),
  'KZT', 1, 100, NULL, NULL,
  jsonb_build_array(
    jsonb_build_object('category_id','33000000-0000-0000-0000-000000000001','amount',60,'base_amount',60),
    jsonb_build_object('category_id','33000000-0000-0000-0000-000000000002','amount',40,'base_amount',40)
  ), ARRAY['split-test']::text[]
)$$, 'member creates an atomic split operation');

SELECT is((SELECT count(*)::integer FROM public.operation_allocations allocation
  JOIN public.operations operation ON operation.id=allocation.operation_id
  WHERE operation.description='Split operation'), 2, 'two allocations are stored');
SELECT is((SELECT sum(allocation.amount) FROM public.operation_allocations allocation
  JOIN public.operations operation ON operation.id=allocation.operation_id
  WHERE operation.description='Split operation'), 100::numeric, 'allocation amount reconciles');
SELECT is((SELECT count(*)::integer FROM public.operation_tags link
  JOIN public.operations operation ON operation.id=link.operation_id
  JOIN public.tags tag ON tag.id=link.tag_id
  WHERE operation.description='Split operation' AND tag.name='split-test'), 1, 'tags are committed atomically');

SELECT throws_ok($$SELECT public.create_operation_with_allocations(
  '23000000-0000-0000-0000-000000000001', 100, 'expense', 'Bad split', CURRENT_DATE,
  NULL, NULL,
  (SELECT id FROM public.accounts WHERE workspace_id='23000000-0000-0000-0000-000000000001' AND is_default),
  'KZT', 1, 100, NULL, NULL,
  jsonb_build_array(jsonb_build_object('category_id','33000000-0000-0000-0000-000000000001','amount',90,'base_amount',90)), '{}'::text[]
)$$, 'P0001', NULL, 'mismatched split rolls back');

SELECT is((SELECT count(*)::integer FROM public.operations WHERE description='Bad split'), 0, 'failed split leaves no operation');
SELECT throws_ok($$INSERT INTO public.operation_allocations(workspace_id,operation_id,category_id,amount,base_amount,position)
  SELECT operation.workspace_id,operation.id,'33000000-0000-0000-0000-000000000001',1,1,9
  FROM public.operations operation WHERE operation.description='Split operation'$$,
  '42501', NULL, 'direct allocation writes are denied');

SELECT set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000003', true);
SELECT throws_ok($$SELECT public.create_operation_with_allocations(
  '23000000-0000-0000-0000-000000000001', 10, 'expense', 'Viewer split', CURRENT_DATE,
  '33000000-0000-0000-0000-000000000001', NULL,
  (SELECT id FROM public.accounts WHERE workspace_id='23000000-0000-0000-0000-000000000001' AND is_default),
  'KZT',1,10,NULL,NULL,'[]','{}'::text[]
)$$, 'P0001', 'Недостаточно прав для создания операции', 'viewer cannot create operation');

RESET ROLE;
INSERT INTO public.budgets(workspace_id,category_id,month,amount,created_by)
VALUES ('23000000-0000-0000-0000-000000000001','33000000-0000-0000-0000-000000000001',date_trunc('month',CURRENT_DATE)::date,1000,'13000000-0000-0000-0000-000000000001');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000001', true);
SELECT is((SELECT spent FROM public.get_budget_progress('23000000-0000-0000-0000-000000000001',CURRENT_DATE)
  WHERE category_id='33000000-0000-0000-0000-000000000001'), 60::numeric, 'budget uses allocation rather than parent category');

SELECT lives_ok($$SELECT public.transition_operation_status(
  (SELECT id FROM public.operations WHERE description='Split operation'),'reconciled',NULL
)$$, 'owner reconciles split operation');
SELECT throws_ok($$SELECT public.replace_operation_allocations(
  (SELECT id FROM public.operations WHERE description='Split operation'),'[]'
)$$, 'P0001', 'Сверенную операцию сначала необходимо вернуть на проверку', 'reconciled split is immutable');

SELECT * FROM finish();
ROLLBACK;
