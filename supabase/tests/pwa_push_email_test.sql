BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(14);

INSERT INTO auth.users(id, email) VALUES
  ('17000000-0000-0000-0000-000000000001', 'offline-owner@example.test'),
  ('17000000-0000-0000-0000-000000000002', 'offline-member@example.test'),
  ('17000000-0000-0000-0000-000000000003', 'offline-outsider@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.workspaces(id, owner_id, name, is_personal, workspace_type)
VALUES ('27000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000001', 'Offline fixture', false, 'business');
INSERT INTO public.workspace_members(workspace_id, user_id, role) VALUES
  ('27000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000001', 'Owner'),
  ('27000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000002', 'Member');
INSERT INTO public.categories(id, workspace_id, name, type)
VALUES ('37000000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-000000000001', 'Offline expense', 'expense');

SELECT has_table('public', 'offline_operation_requests', 'offline idempotency table exists');
SELECT has_function('public', 'create_offline_expense', ARRAY[
  'uuid','uuid','numeric','text','text','date','uuid','uuid','uuid','text','numeric','numeric','uuid','numeric','jsonb','text[]'
], 'offline expense RPC exists');
SELECT has_table('public', 'push_subscriptions', 'push subscription table exists');
SELECT has_function('public', 'upsert_push_subscription', ARRAY['uuid','text','text','text','text'], 'push subscription RPC exists');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '17000000-0000-0000-0000-000000000002', true);

SELECT lives_ok($$SELECT public.create_offline_expense(
  '47000000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-000000000001',
  1250, 'expense', 'Offline lunch', CURRENT_DATE,
  '37000000-0000-0000-0000-000000000001', NULL,
  (SELECT id FROM public.accounts WHERE workspace_id='27000000-0000-0000-0000-000000000001' AND is_default),
  'KZT', 1, 1250, NULL, NULL, '[]', ARRAY['offline']::text[]
)$$, 'member synchronizes an offline expense');
SELECT lives_ok($$SELECT public.create_offline_expense(
  '47000000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-000000000001',
  1250, 'expense', 'Offline lunch', CURRENT_DATE,
  '37000000-0000-0000-0000-000000000001', NULL,
  (SELECT id FROM public.accounts WHERE workspace_id='27000000-0000-0000-0000-000000000001' AND is_default),
  'KZT', 1, 1250, NULL, NULL, '[]', ARRAY['offline']::text[]
)$$, 'retry with the same request id is idempotent');
SELECT is((SELECT count(*)::integer FROM public.operations WHERE description='Offline lunch'), 1, 'idempotent retry creates one operation');
SELECT is((SELECT count(*)::integer FROM public.offline_operation_requests WHERE client_request_id='47000000-0000-0000-0000-000000000001'), 1, 'one request receipt is stored');
SELECT throws_ok($$SELECT public.create_offline_expense(
  '47000000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-000000000001',
  1300, 'expense', 'Changed payload', CURRENT_DATE,
  '37000000-0000-0000-0000-000000000001', NULL,
  (SELECT id FROM public.accounts WHERE workspace_id='27000000-0000-0000-0000-000000000001' AND is_default),
  'KZT', 1, 1300, NULL, NULL, '[]', '{}'
)$$, 'P0001', 'Идентификатор offline-запроса уже использован с другими данными', 'request id cannot be reused for another payload');
SELECT throws_ok($$SELECT public.create_offline_expense(
  '47000000-0000-0000-0000-000000000002', '27000000-0000-0000-0000-000000000001',
  100, 'income', 'Offline income', CURRENT_DATE, NULL, NULL,
  (SELECT id FROM public.accounts WHERE workspace_id='27000000-0000-0000-0000-000000000001' AND is_default),
  'KZT', 1, 100, NULL, NULL, '[]', '{}'
)$$, 'P0001', 'Offline-синхронизация разрешена только для расходов', 'offline income is rejected');

SELECT lives_ok($$SELECT public.upsert_push_subscription(
  '27000000-0000-0000-0000-000000000001',
  'https://push.example.test/subscription/member-0001',
  'BCabcdefghijklmnopqrstuvwxyz0123456789',
  'auth-token-0001', 'pgTAP browser'
)$$, 'member registers a Web Push subscription');
SELECT is((SELECT count(*)::integer FROM public.push_subscriptions), 1, 'member sees own push subscription');
SELECT throws_ok($$INSERT INTO public.push_subscriptions(workspace_id,user_id,endpoint,p256dh,auth)
  VALUES ('27000000-0000-0000-0000-000000000001','17000000-0000-0000-0000-000000000002','https://push.example.test/direct-write-blocked','BCabcdefghijklmnopqrstuvwxyz0123456789','auth-token-0002')$$,
  '42501', NULL, 'direct push subscription writes are denied');

SELECT set_config('request.jwt.claim.sub', '17000000-0000-0000-0000-000000000003', true);
SELECT is((SELECT count(*)::integer FROM public.push_subscriptions), 0, 'outsider cannot read push subscriptions');

SELECT * FROM finish();
ROLLBACK;
