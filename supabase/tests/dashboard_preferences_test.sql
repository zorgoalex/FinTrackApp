BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(10);

INSERT INTO auth.users(id,email) VALUES
 ('19000000-0000-0000-0000-000000000001','dashboard-owner@example.test'),
 ('19000000-0000-0000-0000-000000000002','dashboard-member@example.test'),
 ('19000000-0000-0000-0000-000000000003','dashboard-outsider@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.workspaces(id,owner_id,name,is_personal,workspace_type,base_currency)
VALUES ('29000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001','Dashboard fixture',false,'business','KZT');
INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES
 ('29000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000001','Owner'),
 ('29000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000002','Member');

SELECT has_table('public','dashboard_preferences','dashboard preferences remain available');
SELECT hasnt_table('public','net_worth_items','net worth items are removed');
SELECT hasnt_table('public','net_worth_valuations','net worth valuations are removed');
SELECT hasnt_table('public','net_worth_goals','net worth goals are removed');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','19000000-0000-0000-0000-000000000002',true);
SELECT lives_ok($$INSERT INTO public.dashboard_preferences(workspace_id,user_id,hidden_widgets,widget_sizes)
VALUES ('29000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000002',ARRAY['debts'],'{"accounts":"wide"}')$$,
  'member stores own dashboard preferences');
SELECT is((SELECT hidden_widgets FROM public.dashboard_preferences
  WHERE workspace_id='29000000-0000-0000-0000-000000000001'
    AND user_id='19000000-0000-0000-0000-000000000002'),ARRAY['debts']::text[],
  'member reads own dashboard preferences');
SELECT throws_ok($$UPDATE public.dashboard_preferences SET widget_order=ARRAY['summary','net_worth']
  WHERE workspace_id='29000000-0000-0000-0000-000000000001'
    AND user_id='19000000-0000-0000-0000-000000000002'$$,'23514',NULL,
  'removed net worth widget cannot return through preferences');
SELECT lives_ok($$UPDATE public.dashboard_preferences SET widget_order=ARRAY['summary','accounts','recent_operations']
  WHERE workspace_id='29000000-0000-0000-0000-000000000001'
    AND user_id='19000000-0000-0000-0000-000000000002'$$,
  'member updates own widget order');

SELECT set_config('request.jwt.claim.sub','19000000-0000-0000-0000-000000000003',true);
SELECT is((SELECT count(*)::integer FROM public.dashboard_preferences
  WHERE workspace_id='29000000-0000-0000-0000-000000000001'),0,
  'outsider cannot read dashboard preferences');
SELECT throws_ok($$INSERT INTO public.dashboard_preferences(workspace_id,user_id)
VALUES ('29000000-0000-0000-0000-000000000001','19000000-0000-0000-0000-000000000003')$$,
  '42501',NULL,'outsider cannot create dashboard preferences');

SELECT * FROM finish();
ROLLBACK;
