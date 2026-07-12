BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(11);

INSERT INTO auth.users(id,email) VALUES
 ('17000000-0000-0000-0000-000000000001','restore-owner@example.test'),
 ('17000000-0000-0000-0000-000000000002','restore-member@example.test'),
 ('17000000-0000-0000-0000-000000000003','restore-outsider@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.workspaces(id,owner_id,name,is_personal,workspace_type,base_currency)
VALUES ('27000000-0000-0000-0000-000000000001','17000000-0000-0000-0000-000000000001','Restore fixture',false,'business','KZT');
INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES
 ('27000000-0000-0000-0000-000000000001','17000000-0000-0000-0000-000000000001','Owner'),
 ('27000000-0000-0000-0000-000000000001','17000000-0000-0000-0000-000000000002','Member');

CREATE TEMP TABLE restore_fixture(document jsonb);
INSERT INTO restore_fixture(document)
SELECT jsonb_build_object(
 'format','fintrack-workspace-backup','version',2,
 'workspace',jsonb_build_object('id','27000000-0000-0000-0000-000000000001','name','Restore fixture'),
 'data',jsonb_build_object('categories',jsonb_build_array(to_jsonb(category)))
)
FROM public.categories category
WHERE category.workspace_id='27000000-0000-0000-0000-000000000001'
ORDER BY category.name LIMIT 1;
GRANT SELECT ON restore_fixture TO authenticated;

SELECT has_function('public','restore_workspace_backup',ARRAY['uuid','jsonb','boolean'],'restore RPC exists');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','17000000-0000-0000-0000-000000000001',true);
SELECT lives_ok($$SELECT public.restore_workspace_backup('27000000-0000-0000-0000-000000000001',(SELECT document FROM restore_fixture),true)$$,'owner previews backup');
SELECT is(((SELECT public.restore_workspace_backup('27000000-0000-0000-0000-000000000001',document,true) FROM restore_fixture)->>'totalRows')::integer,1,'preview returns total rows');

UPDATE public.categories SET name='Changed after backup'
WHERE id=((SELECT document#>>'{data,categories,0,id}' FROM restore_fixture)::uuid);
SELECT is((SELECT name FROM public.categories WHERE id=((SELECT document#>>'{data,categories,0,id}' FROM restore_fixture)::uuid)),'Changed after backup','dry run does not mutate');
SELECT lives_ok($$SELECT public.restore_workspace_backup('27000000-0000-0000-0000-000000000001',(SELECT document FROM restore_fixture),false)$$,'owner restores atomically');
SELECT isnt((SELECT name FROM public.categories WHERE id=((SELECT document#>>'{data,categories,0,id}' FROM restore_fixture)::uuid)),'Changed after backup','actual restore updates existing row');

SELECT set_config('request.jwt.claim.sub','17000000-0000-0000-0000-000000000002',true);
SELECT throws_ok($$SELECT public.restore_workspace_backup('27000000-0000-0000-0000-000000000001',(SELECT document FROM restore_fixture),true)$$,'P0001','Только владелец или администратор может восстановить резервную копию','member cannot restore');
SELECT set_config('request.jwt.claim.sub','17000000-0000-0000-0000-000000000003',true);
SELECT throws_ok($$SELECT public.restore_workspace_backup('27000000-0000-0000-0000-000000000001',(SELECT document FROM restore_fixture),true)$$,'P0001','Только владелец или администратор может восстановить резервную копию','outsider cannot restore');
SELECT set_config('request.jwt.claim.sub','17000000-0000-0000-0000-000000000001',true);
SELECT throws_ok($$SELECT public.restore_workspace_backup('27000000-0000-0000-0000-000000000001',jsonb_build_object('format','fintrack-workspace-backup','version',1),true)$$,'P0001','Поддерживается резервная копия FinTrack версии 2','legacy version rejected');
SELECT throws_ok($$SELECT public.restore_workspace_backup('27000000-0000-0000-0000-000000000001',jsonb_set((SELECT document FROM restore_fixture),'{workspace,id}','"aaaaaaaa-0000-0000-0000-000000000001"'),true)$$,'P0001','Копия создана для другого рабочего пространства','foreign backup rejected');
SELECT throws_ok($$SELECT public.restore_workspace_backup('27000000-0000-0000-0000-000000000001',jsonb_set((SELECT document FROM restore_fixture),'{data,categories,0,workspace_id}','"aaaaaaaa-0000-0000-0000-000000000001"'),true)$$,'P0001','Раздел categories содержит запись другого пространства','foreign row rejected in preview');

SELECT * FROM finish();
ROLLBACK;
