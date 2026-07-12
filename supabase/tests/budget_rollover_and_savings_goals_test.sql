BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(21);

INSERT INTO auth.users(id,email) VALUES
 ('14000000-0000-0000-0000-000000000001','budget-owner@example.test'),
 ('14000000-0000-0000-0000-000000000002','budget-member@example.test'),
 ('14000000-0000-0000-0000-000000000003','budget-viewer@example.test'),
 ('14000000-0000-0000-0000-000000000004','budget-other@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.workspaces(id,owner_id,name,is_personal,workspace_type) VALUES
 ('24000000-0000-0000-0000-000000000001','14000000-0000-0000-0000-000000000001','Budget fixture',false,'business'),
 ('24000000-0000-0000-0000-000000000002','14000000-0000-0000-0000-000000000004','Other fixture',false,'business');
INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES
 ('24000000-0000-0000-0000-000000000001','14000000-0000-0000-0000-000000000001','Owner'),
 ('24000000-0000-0000-0000-000000000001','14000000-0000-0000-0000-000000000002','Member'),
 ('24000000-0000-0000-0000-000000000001','14000000-0000-0000-0000-000000000003','Viewer'),
 ('24000000-0000-0000-0000-000000000002','14000000-0000-0000-0000-000000000004','Owner');
INSERT INTO public.categories(id,workspace_id,name,type) VALUES
 ('34000000-0000-0000-0000-000000000001','24000000-0000-0000-0000-000000000001','Carry category','expense'),
 ('34000000-0000-0000-0000-000000000002','24000000-0000-0000-0000-000000000001','Full category','expense');

SELECT has_column('public','budgets','rollover_mode','budgets expose rollover mode');
SELECT has_table('public','savings_goals','savings goals table exists');
SELECT has_table('public','savings_goal_contributions','goal contributions table exists');
SELECT has_function('public','ensure_budget_period',ARRAY['uuid','uuid','date','numeric','text','numeric'],'budget period RPC exists');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','14000000-0000-0000-0000-000000000001',true);
SELECT lives_ok($$SELECT public.ensure_budget_period(
 '24000000-0000-0000-0000-000000000001','34000000-0000-0000-0000-000000000001','2026-01-01',100,'unused',50
)$$,'owner creates first budget period');
SELECT lives_ok($$SELECT public.ensure_budget_period(
 '24000000-0000-0000-0000-000000000001','34000000-0000-0000-0000-000000000002','2026-01-01',100,'full',NULL
)$$,'owner creates full-rollover period');
RESET ROLE;

INSERT INTO public.operations(id,workspace_id,user_id,amount,type,description,operation_date,category_id,account_id,currency,exchange_rate,base_amount)
VALUES
 ('54000000-0000-0000-0000-000000000001','24000000-0000-0000-0000-000000000001','14000000-0000-0000-0000-000000000001',40,'expense','January carry spend','2026-01-15','34000000-0000-0000-0000-000000000001',(SELECT id FROM public.accounts WHERE workspace_id='24000000-0000-0000-0000-000000000001' AND is_default),'KZT',1,40),
 ('54000000-0000-0000-0000-000000000002','24000000-0000-0000-0000-000000000001','14000000-0000-0000-0000-000000000001',120,'expense','January overspend','2026-01-15','34000000-0000-0000-0000-000000000002',(SELECT id FROM public.accounts WHERE workspace_id='24000000-0000-0000-0000-000000000001' AND is_default),'KZT',1,120),
 ('54000000-0000-0000-0000-000000000003','24000000-0000-0000-0000-000000000001','14000000-0000-0000-0000-000000000001',30,'expense','February split','2026-02-15',NULL,(SELECT id FROM public.accounts WHERE workspace_id='24000000-0000-0000-0000-000000000001' AND is_default),'KZT',1,30),
 ('54000000-0000-0000-0000-000000000004','24000000-0000-0000-0000-000000000002','14000000-0000-0000-0000-000000000004',10,'income','Other workspace operation','2026-02-15',NULL,(SELECT id FROM public.accounts WHERE workspace_id='24000000-0000-0000-0000-000000000002' AND is_default),'KZT',1,10);
INSERT INTO public.operation_allocations(workspace_id,operation_id,category_id,amount,base_amount,position) VALUES
 ('24000000-0000-0000-0000-000000000001','54000000-0000-0000-0000-000000000003','34000000-0000-0000-0000-000000000001',20,20,0),
 ('24000000-0000-0000-0000-000000000001','54000000-0000-0000-0000-000000000003','34000000-0000-0000-0000-000000000002',10,10,1);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','14000000-0000-0000-0000-000000000001',true);
SELECT lives_ok($$SELECT public.ensure_budget_period(
 '24000000-0000-0000-0000-000000000001','34000000-0000-0000-0000-000000000001','2026-02-01'
)$$,'next unused period is derived');
SELECT is((SELECT carryover_amount FROM public.budgets WHERE category_id='34000000-0000-0000-0000-000000000001' AND month='2026-02-01'),50::numeric,'unused carry is capped');
SELECT is((SELECT count(*)::integer FROM public.budgets WHERE category_id='34000000-0000-0000-0000-000000000001' AND month='2026-02-01'),1,'ensure is idempotent');
SELECT lives_ok($$SELECT public.ensure_budget_period(
 '24000000-0000-0000-0000-000000000001','34000000-0000-0000-0000-000000000002','2026-02-01'
)$$,'next full period is derived');
SELECT is((SELECT carryover_amount FROM public.budgets WHERE category_id='34000000-0000-0000-0000-000000000002' AND month='2026-02-01'),(-20)::numeric,'full rollover carries overspend');
SELECT is((SELECT spent FROM public.get_budget_progress('24000000-0000-0000-0000-000000000001','2026-02-01') WHERE category_id='34000000-0000-0000-0000-000000000001'),20::numeric,'budget progress is split-aware');

RESET ROLE;
INSERT INTO public.savings_goals(id,workspace_id,name,target_amount,target_date,account_id,created_by)
VALUES ('44000000-0000-0000-0000-000000000001','24000000-0000-0000-0000-000000000001','Emergency fund',200,'2026-12-31',(SELECT id FROM public.accounts WHERE workspace_id='24000000-0000-0000-0000-000000000001' AND is_default),'14000000-0000-0000-0000-000000000001');
SELECT throws_ok($$UPDATE public.savings_goals SET account_id=(SELECT id FROM public.accounts WHERE workspace_id='24000000-0000-0000-0000-000000000002' AND is_default) WHERE id='44000000-0000-0000-0000-000000000001'$$,'23503',NULL,'goal rejects another workspace account');
SELECT throws_ok($$INSERT INTO public.savings_goal_contributions(workspace_id,goal_id,amount,operation_id,created_by) VALUES ('24000000-0000-0000-0000-000000000001','44000000-0000-0000-0000-000000000001',10,'54000000-0000-0000-0000-000000000004','14000000-0000-0000-0000-000000000001')$$,'23503',NULL,'contribution rejects another workspace operation');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','14000000-0000-0000-0000-000000000002',true);
SELECT lives_ok($$SELECT public.add_savings_goal_contribution('44000000-0000-0000-0000-000000000001',50,'2026-02-20')$$,'member contributes through RPC');
SELECT is((SELECT saved_amount FROM public.get_savings_goal_progress('24000000-0000-0000-0000-000000000001') WHERE id='44000000-0000-0000-0000-000000000001'),50::numeric,'goal progress sums contributions');
SELECT throws_ok($$SELECT public.transition_savings_goal_status('44000000-0000-0000-0000-000000000001','paused')$$,'P0001','Недостаточно прав для изменения статуса цели','member cannot change goal status');

SELECT set_config('request.jwt.claim.sub','14000000-0000-0000-0000-000000000001',true);
SELECT lives_ok($$SELECT public.transition_savings_goal_status('44000000-0000-0000-0000-000000000001','paused')$$,'owner pauses goal');
SELECT throws_ok($$SELECT public.add_savings_goal_contribution('44000000-0000-0000-0000-000000000001',10)$$,'P0001','Пополнять можно только активную цель','paused goal rejects contribution');

SELECT set_config('request.jwt.claim.sub','14000000-0000-0000-0000-000000000003',true);
SELECT throws_ok($$INSERT INTO public.savings_goals(workspace_id,name,target_amount,created_by) VALUES ('24000000-0000-0000-0000-000000000001','Viewer goal',100,'14000000-0000-0000-0000-000000000003')$$,'42501',NULL,'viewer cannot create goal');
SELECT is((SELECT count(*)::integer FROM public.savings_goals WHERE workspace_id='24000000-0000-0000-0000-000000000001'),1,'viewer can read workspace goals');

SELECT * FROM finish();
ROLLBACK;
