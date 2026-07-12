BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT plan(13);

INSERT INTO auth.users(id,email) VALUES
 ('18000000-0000-0000-0000-000000000001','bulk-owner@example.test'),
 ('18000000-0000-0000-0000-000000000002','bulk-member@example.test') ON CONFLICT(id) DO NOTHING;
INSERT INTO public.workspaces(id,owner_id,name,is_personal,workspace_type,base_currency)
VALUES ('28000000-0000-0000-0000-000000000001','18000000-0000-0000-0000-000000000001','Bulk fixture',false,'business','KZT');
INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES
 ('28000000-0000-0000-0000-000000000001','18000000-0000-0000-0000-000000000001','Owner'),
 ('28000000-0000-0000-0000-000000000001','18000000-0000-0000-0000-000000000002','Member');
INSERT INTO public.categories(id,workspace_id,name,type,color) VALUES
 ('38000000-0000-0000-0000-000000000001','28000000-0000-0000-0000-000000000001','Bulk category','expense','#111111');
INSERT INTO public.tags(id,workspace_id,name,color) VALUES
 ('48000000-0000-0000-0000-000000000001','28000000-0000-0000-0000-000000000001','bulk-tag','#222222');
INSERT INTO public.operations(id,workspace_id,user_id,amount,type,operation_date,status,account_id,currency,exchange_rate,base_amount) SELECT
 value.id::uuid,'28000000-0000-0000-0000-000000000001','18000000-0000-0000-0000-000000000001',100,'expense',CURRENT_DATE,value.status,accounts.id,'KZT',1,100
FROM public.accounts CROSS JOIN (VALUES ('58000000-0000-0000-0000-000000000001','new'),('58000000-0000-0000-0000-000000000002','verified')) value(id,status)
WHERE workspace_id='28000000-0000-0000-0000-000000000001' AND is_default;

SELECT has_function('public','bulk_update_operations',ARRAY['uuid','uuid[]','uuid','boolean','text','text','uuid[]','boolean'],'bulk RPC exists');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','18000000-0000-0000-0000-000000000002',true);
SELECT throws_ok($$SELECT public.bulk_update_operations('28000000-0000-0000-0000-000000000001',ARRAY['58000000-0000-0000-0000-000000000001']::uuid[],NULL,false,'verified',NULL,NULL,false)$$,'P0001','Только владелец или администратор может массово изменять операции','member rejected');
SELECT set_config('request.jwt.claim.sub','18000000-0000-0000-0000-000000000001',true);
SELECT throws_ok($$SELECT public.bulk_update_operations('28000000-0000-0000-0000-000000000001',ARRAY['58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000001']::uuid[],NULL,false,'verified',NULL,NULL,false)$$,'P0001','Список операций содержит дубли','duplicate IDs rejected');
SELECT is(public.bulk_update_operations('28000000-0000-0000-0000-000000000001',ARRAY['58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002']::uuid[],'38000000-0000-0000-0000-000000000001',true,NULL,NULL,ARRAY['48000000-0000-0000-0000-000000000001']::uuid[],false),2,'category and tag update two rows');
SELECT is((SELECT count(*)::integer FROM public.operations WHERE id IN ('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002') AND category_id='38000000-0000-0000-0000-000000000001'),2,'category applied');
SELECT is((SELECT count(*)::integer FROM public.operation_tags WHERE operation_id IN ('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002')),2,'tag applied');
SELECT is(public.bulk_update_operations('28000000-0000-0000-0000-000000000001',ARRAY['58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002']::uuid[],NULL,false,'verified',NULL,NULL,false),2,'bulk verifies mixed new and verified');
SELECT is((SELECT count(*)::integer FROM public.operations WHERE id IN ('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002') AND status='verified'),2,'both verified');
SELECT is(public.bulk_update_operations('28000000-0000-0000-0000-000000000001',ARRAY['58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002']::uuid[],NULL,false,'reconciled',NULL,NULL,false),2,'bulk reconciles');
SELECT throws_ok($$SELECT public.bulk_update_operations('28000000-0000-0000-0000-000000000001',ARRAY['58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002']::uuid[],NULL,false,'new',NULL,NULL,false)$$,'P0001','Укажите причину отмены статуса','missing rollback reason rejects batch');
SELECT is((SELECT count(*)::integer FROM public.operations WHERE id IN ('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002') AND status='reconciled'),2,'failed batch rolls back fully');
SELECT is(public.bulk_update_operations('28000000-0000-0000-0000-000000000001',ARRAY['58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002']::uuid[],NULL,false,NULL,NULL,ARRAY[]::uuid[],true),2,'bulk clears tags');
SELECT is((SELECT count(*)::integer FROM public.operation_tags WHERE operation_id IN ('58000000-0000-0000-0000-000000000001','58000000-0000-0000-0000-000000000002')),0,'tags cleared');
SELECT * FROM finish();
ROLLBACK;
