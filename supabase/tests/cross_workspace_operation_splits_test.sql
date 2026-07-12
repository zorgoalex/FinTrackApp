BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(13);

INSERT INTO auth.users(id, email) VALUES
  ('15000000-0000-0000-0000-000000000001', 'physical-split-owner@example.test'),
  ('15000000-0000-0000-0000-000000000002', 'physical-split-member@example.test'),
  ('15000000-0000-0000-0000-000000000003', 'physical-split-outsider@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.workspaces(id, owner_id, name, is_personal, workspace_type, base_currency) VALUES
  ('25000000-0000-0000-0000-000000000001', '15000000-0000-0000-0000-000000000001', 'Physical split source', false, 'business', 'KZT'),
  ('25000000-0000-0000-0000-000000000002', '15000000-0000-0000-0000-000000000001', 'Physical split target', false, 'business', 'KZT');
INSERT INTO public.workspace_members(workspace_id, user_id, role) VALUES
  ('25000000-0000-0000-0000-000000000001', '15000000-0000-0000-0000-000000000001', 'Owner'),
  ('25000000-0000-0000-0000-000000000002', '15000000-0000-0000-0000-000000000001', 'Owner'),
  ('25000000-0000-0000-0000-000000000001', '15000000-0000-0000-0000-000000000002', 'Member'),
  ('25000000-0000-0000-0000-000000000002', '15000000-0000-0000-0000-000000000002', 'Member');
INSERT INTO public.categories(id, workspace_id, name, type) VALUES
  ('35000000-0000-0000-0000-000000000001', '25000000-0000-0000-0000-000000000001', 'Source category', 'expense'),
  ('35000000-0000-0000-0000-000000000002', '25000000-0000-0000-0000-000000000002', 'Target category', 'expense');

SELECT has_table('public', 'operation_split_groups', 'physical split group table exists');
SELECT has_column('public', 'operations', 'split_group_id', 'operations link to a physical split group');
SELECT has_function('public', 'split_operation', ARRAY['uuid','jsonb'], 'physical split RPC exists');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-000000000002', true);

SELECT lives_ok($$SELECT public.create_operation_with_allocations(
  '25000000-0000-0000-0000-000000000001', 100, 'expense', 'Physical split operation', CURRENT_DATE,
  '35000000-0000-0000-0000-000000000001', NULL,
  (SELECT id FROM public.accounts WHERE workspace_id='25000000-0000-0000-0000-000000000001' AND is_default),
  'KZT', 1, 100, NULL, NULL, '[]', ARRAY['physical-split']::text[]
)$$, 'member creates the source operation');

SELECT lives_ok($$SELECT public.split_operation(
  (SELECT id FROM public.operations WHERE description='Physical split operation'),
  jsonb_build_array(
    jsonb_build_object(
      'workspace_id','25000000-0000-0000-0000-000000000001',
      'account_id',(SELECT id FROM public.accounts WHERE workspace_id='25000000-0000-0000-0000-000000000001' AND is_default),
      'category_id','35000000-0000-0000-0000-000000000001','amount',60
    ),
    jsonb_build_object(
      'workspace_id','25000000-0000-0000-0000-000000000002',
      'account_id',(SELECT id FROM public.accounts WHERE workspace_id='25000000-0000-0000-0000-000000000002' AND is_default),
      'category_id','35000000-0000-0000-0000-000000000002','amount',40
    )
  )
)$$, 'member atomically moves one part to another accessible workspace');

SELECT is((SELECT count(*)::integer FROM public.operations WHERE description='Physical split operation'), 2, 'two independent operations exist');
SELECT is((SELECT sum(amount) FROM public.operations WHERE description='Physical split operation'), 100::numeric, 'parts preserve the exact original amount');
SELECT is((SELECT count(DISTINCT workspace_id)::integer FROM public.operations WHERE description='Physical split operation'), 2, 'parts affect two workspaces');
SELECT is((SELECT count(*)::integer FROM public.operations WHERE description='Physical split operation' AND status='new'), 2, 'all changed parts require review');
SELECT is((SELECT count(DISTINCT split_group_id)::integer FROM public.operations WHERE description='Physical split operation'), 1, 'parts share one history group');
SELECT is((SELECT count(*)::integer FROM public.operation_tags link
  JOIN public.operations operation ON operation.id=link.operation_id
  JOIN public.tags tag ON tag.id=link.tag_id
  WHERE operation.description='Physical split operation' AND tag.name='physical-split'), 2, 'tag names are copied to destination parts');

SELECT throws_ok($$SELECT public.split_operation(
  (SELECT id FROM public.operations WHERE description='Physical split operation' AND workspace_id='25000000-0000-0000-0000-000000000001'),
  jsonb_build_array(
    jsonb_build_object('workspace_id','25000000-0000-0000-0000-000000000001','account_id',(SELECT id FROM public.accounts WHERE workspace_id='25000000-0000-0000-0000-000000000001' AND is_default),'amount',30),
    jsonb_build_object('workspace_id','25000000-0000-0000-0000-000000000002','account_id',(SELECT id FROM public.accounts WHERE workspace_id='25000000-0000-0000-0000-000000000002' AND is_default),'amount',29)
  )
)$$, 'P0001', NULL, 'mismatched parts are rejected atomically');

SELECT set_config('request.jwt.claim.sub', '15000000-0000-0000-0000-000000000003', true);
SELECT throws_ok($$SELECT public.split_operation(
  (SELECT id FROM public.operations WHERE description='Physical split operation' AND workspace_id='25000000-0000-0000-0000-000000000001'),
  '[]'::jsonb
)$$, 'P0001', 'Недостаточно прав для разделения операции', 'outsider cannot split an operation by guessing its id');

SELECT * FROM finish();
ROLLBACK;
