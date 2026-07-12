BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(24);

INSERT INTO auth.users(id,email) VALUES
 ('19000000-0000-0000-0000-000000000001','net-owner@example.test'),
 ('19000000-0000-0000-0000-000000000002','net-member@example.test'),
 ('19000000-0000-0000-0000-000000000003','net-viewer@example.test'),
 ('19000000-0000-0000-0000-000000000004','net-outsider@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.workspaces(id,owner_id,name,is_personal,workspace_type,base_currency)
VALUES ('29000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001','Net worth fixture',false,'business','KZT');
INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES
 ('29000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001','Owner'),
 ('29000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000002','Member'),
 ('29000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000003','Viewer');
UPDATE public.accounts SET opening_balance=1000, opening_date='2026-01-01'
WHERE workspace_id='29000000-0000-0000-0000-000000000001' AND is_default;

SELECT has_table('public','net_worth_items','net worth items table exists');
SELECT has_table('public','net_worth_valuations','valuation history table exists');
SELECT has_table('public','net_worth_goals','net worth goals table exists');
SELECT has_table('public','dashboard_preferences','dashboard preferences table exists');
SELECT has_function('public','get_net_worth_report',ARRAY['uuid','date'],'net worth report RPC exists');
SELECT has_function('public','get_net_worth_history',ARRAY['uuid','date','date','text'],'net worth history RPC exists');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','19000000-0000-0000-0000-000000000001',true);
SELECT lives_ok($$INSERT INTO public.net_worth_items(
 id,workspace_id,kind,category,name,currency,current_value,exchange_rate,current_base_value,valued_on,created_by
) VALUES (
 '39000000-0000-0000-0000-000000000001','29000000-0000-0000-0000-000000000001','asset','investment','Brokerage','KZT',500,1,500,'2026-01-01','19000000-0000-0000-0000-000000000001'
)$$,'owner creates an asset');
SELECT is((SELECT count(*)::integer FROM public.net_worth_valuations WHERE item_id='39000000-0000-0000-0000-000000000001'),1,'initial valuation is recorded');
SELECT lives_ok($$UPDATE public.net_worth_items SET current_value=550,current_base_value=550 WHERE id='39000000-0000-0000-0000-000000000001'$$,'owner updates same-day valuation');
SELECT is((SELECT count(*)::integer FROM public.net_worth_valuations WHERE item_id='39000000-0000-0000-0000-000000000001'),1,'same-day valuation is upserted');
SELECT lives_ok($$INSERT INTO public.net_worth_items(
 id,workspace_id,kind,category,name,currency,current_value,exchange_rate,current_base_value,valued_on,created_by
) VALUES (
 '39000000-0000-0000-0000-000000000002','29000000-0000-0000-0000-000000000001','liability','loan','Loan','KZT',200,1,200,'2026-01-01','19000000-0000-0000-0000-000000000001'
)$$,'owner creates a liability');
SELECT lives_ok($$INSERT INTO public.net_worth_goals(workspace_id,name,target_amount,target_date,created_by)
VALUES ('29000000-0000-0000-0000-000000000001','Capital goal',3000,'2026-12-31','19000000-0000-0000-0000-000000000001')$$,'owner creates a net worth goal');

RESET ROLE;
INSERT INTO public.debts(id,workspace_id,title,counterparty,direction,initial_amount,opened_on,currency,created_by)
VALUES
 ('49000000-0000-0000-0000-000000000001','29000000-0000-0000-0000-000000000001','Receivable','Client','owed_to_me',300,'2026-01-01','KZT','19000000-0000-0000-0000-000000000001'),
 ('49000000-0000-0000-0000-000000000002','29000000-0000-0000-0000-000000000001','Payable','Supplier','i_owe',100,'2026-01-01','KZT','19000000-0000-0000-0000-000000000001');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','19000000-0000-0000-0000-000000000001',true);
SELECT is((SELECT total_assets FROM public.get_net_worth_report('29000000-0000-0000-0000-000000000001','2026-01-01')),1850::numeric,'assets include cash manual assets and receivables');
SELECT is((SELECT total_liabilities FROM public.get_net_worth_report('29000000-0000-0000-0000-000000000001','2026-01-01')),300::numeric,'liabilities include manual and debt payables');
SELECT is((SELECT net_worth FROM public.get_net_worth_report('29000000-0000-0000-0000-000000000001','2026-01-01')),1550::numeric,'net worth subtracts all liabilities');
SELECT is((SELECT count(*)::integer FROM public.get_net_worth_history('29000000-0000-0000-0000-000000000001','2026-01-01','2026-03-01','month')),3,'monthly history returns requested points');
SELECT throws_ok($$SELECT * FROM public.get_net_worth_history('29000000-0000-0000-0000-000000000001','2026-03-01','2026-01-01','month')$$,'P0001','Некорректный диапазон дат','invalid history range is rejected');

SELECT set_config('request.jwt.claim.sub','19000000-0000-0000-0000-000000000002',true);
SELECT is((SELECT count(*)::integer FROM public.net_worth_items WHERE workspace_id='29000000-0000-0000-0000-000000000001'),2,'member can read net worth items');
SELECT throws_ok($$INSERT INTO public.net_worth_items(workspace_id,kind,category,name,currency,current_value,exchange_rate,current_base_value,created_by)
VALUES ('29000000-0000-0000-0000-000000000001','asset','other_asset','Forbidden','KZT',1,1,1,'19000000-0000-0000-0000-000000000002')$$,'42501',NULL,'member cannot create assets');
SELECT lives_ok($$INSERT INTO public.dashboard_preferences(workspace_id,user_id,hidden_widgets)
VALUES ('29000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000002',ARRAY['debts'])$$,'member stores own dashboard preferences');
SELECT throws_ok($$INSERT INTO public.net_worth_goals(workspace_id,name,target_amount,created_by)
VALUES ('29000000-0000-0000-0000-000000000001','Forbidden goal',1,'19000000-0000-0000-0000-000000000002')$$,'42501',NULL,'member cannot create net worth goals');

SELECT set_config('request.jwt.claim.sub','19000000-0000-0000-0000-000000000003',true);
SELECT is((SELECT count(*)::integer FROM public.net_worth_items WHERE workspace_id='29000000-0000-0000-0000-000000000001'),2,'viewer can read net worth items');

SELECT set_config('request.jwt.claim.sub','19000000-0000-0000-0000-000000000004',true);
SELECT is((SELECT count(*)::integer FROM public.net_worth_items WHERE workspace_id='29000000-0000-0000-0000-000000000001'),0,'outsider cannot read net worth items');
SELECT is((SELECT count(*)::integer FROM public.dashboard_preferences WHERE workspace_id='29000000-0000-0000-0000-000000000001'),0,'users cannot read another dashboard profile');

SELECT * FROM finish();
ROLLBACK;
