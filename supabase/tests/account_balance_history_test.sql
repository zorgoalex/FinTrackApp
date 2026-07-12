BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(17);

INSERT INTO auth.users(id, email) VALUES
  ('16000000-0000-0000-0000-000000000001', 'balance-owner@example.test'),
  ('16000000-0000-0000-0000-000000000002', 'balance-member@example.test'),
  ('16000000-0000-0000-0000-000000000003', 'balance-outsider@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspaces(id, owner_id, name, is_personal, workspace_type, base_currency)
VALUES ('26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000001',
  'Balance history fixture', false, 'business', 'KZT');
INSERT INTO public.workspace_members(workspace_id, user_id, role) VALUES
  ('26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000001', 'Owner'),
  ('26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000002', 'Member');

UPDATE public.accounts
SET name='KZT wallet', currency='KZT', opening_balance=1000, opening_date='2026-01-01'
WHERE workspace_id='26000000-0000-0000-0000-000000000001' AND is_default;
INSERT INTO public.accounts(id, workspace_id, name, currency, opening_balance, opening_date)
VALUES ('36000000-0000-0000-0000-000000000002', '26000000-0000-0000-0000-000000000001',
  'USD wallet', 'USD', 10, '2026-01-02');
INSERT INTO public.exchange_rates(workspace_id, from_currency, to_currency, rate, rate_date, source)
VALUES ('26000000-0000-0000-0000-000000000001', 'USD', 'KZT', 500, '2026-01-02', 'test');

INSERT INTO public.operations(workspace_id,user_id,amount,type,description,operation_date,account_id,currency,exchange_rate,base_amount)
SELECT '26000000-0000-0000-0000-000000000001','16000000-0000-0000-0000-000000000001',200,'income','income','2026-01-01',id,'KZT',1,200
FROM public.accounts WHERE workspace_id='26000000-0000-0000-0000-000000000001' AND is_default;
INSERT INTO public.operations(workspace_id,user_id,amount,type,description,operation_date,account_id,currency,exchange_rate,base_amount)
SELECT '26000000-0000-0000-0000-000000000001','16000000-0000-0000-0000-000000000001',50,'expense','expense','2026-01-02',id,'KZT',1,50
FROM public.accounts WHERE workspace_id='26000000-0000-0000-0000-000000000001' AND is_default;

-- Cross-currency transfer: 1000 KZT out, 2 USD in, both represented in base KZT.
INSERT INTO public.operations(workspace_id,user_id,amount,type,description,operation_date,account_id,
  transfer_group_id,transfer_direction,currency,exchange_rate,base_amount)
SELECT '26000000-0000-0000-0000-000000000001','16000000-0000-0000-0000-000000000001',1000,'transfer','fx transfer','2026-01-03',id,
  '46000000-0000-0000-0000-000000000001','out','KZT',1,1000
FROM public.accounts WHERE workspace_id='26000000-0000-0000-0000-000000000001' AND is_default;
INSERT INTO public.operations(workspace_id,user_id,amount,type,description,operation_date,account_id,
  transfer_group_id,transfer_direction,currency,exchange_rate,base_amount)
VALUES ('26000000-0000-0000-0000-000000000001','16000000-0000-0000-0000-000000000001',2,'transfer','fx transfer','2026-01-03',
  '36000000-0000-0000-0000-000000000002','46000000-0000-0000-0000-000000000001','in','USD',500,1000);

SELECT has_column('public','accounts','opening_balance','accounts have an opening balance');
SELECT has_column('public','accounts','opening_date','accounts have an opening date');
SELECT has_function('public','get_account_balance_history',ARRAY['uuid','date','date','text','uuid[]'],
  'balance history RPC exists');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000002', true);

SELECT is((SELECT count(*)::integer FROM public.get_account_balance_history(
  '26000000-0000-0000-0000-000000000001','2026-01-01','2026-01-03','day',NULL)), 6,
  'daily history returns every active account and day');
SELECT is((SELECT opening_balance FROM public.get_account_balance_history(
  '26000000-0000-0000-0000-000000000001','2026-01-01','2026-01-03','day',NULL)
  WHERE account_name='KZT wallet' AND period_start='2026-01-01'), 1000::numeric, 'native opening is included');
SELECT is((SELECT change FROM public.get_account_balance_history(
  '26000000-0000-0000-0000-000000000001','2026-01-01','2026-01-03','day',NULL)
  WHERE account_name='KZT wallet' AND period_start='2026-01-01'), 200::numeric, 'income increases balance');
SELECT is((SELECT closing_balance FROM public.get_account_balance_history(
  '26000000-0000-0000-0000-000000000001','2026-01-01','2026-01-03','day',NULL)
  WHERE account_name='KZT wallet' AND period_start='2026-01-02'), 1150::numeric, 'expense decreases carried balance');
SELECT is((SELECT change FROM public.get_account_balance_history(
  '26000000-0000-0000-0000-000000000001','2026-01-01','2026-01-03','day',NULL)
  WHERE account_name='KZT wallet' AND period_start='2026-01-03'), (-1000)::numeric, 'transfer out decreases source');
SELECT is((SELECT change FROM public.get_account_balance_history(
  '26000000-0000-0000-0000-000000000001','2026-01-01','2026-01-03','day',NULL)
  WHERE account_name='USD wallet' AND period_start='2026-01-03'), 2::numeric, 'transfer in increases destination');
SELECT is((SELECT opening_base_balance FROM public.get_account_balance_history(
  '26000000-0000-0000-0000-000000000001','2026-01-01','2026-01-03','day',NULL)
  WHERE account_name='USD wallet' AND period_start='2026-01-02'), 5000::numeric, 'foreign opening uses opening-date FX rate');
SELECT is((SELECT closing_base_balance FROM public.get_account_balance_history(
  '26000000-0000-0000-0000-000000000001','2026-01-01','2026-01-03','day',NULL)
  WHERE account_name='USD wallet' AND period_start='2026-01-03'), 6000::numeric, 'base balance uses stored transfer base amount');
SELECT is((SELECT count(*)::integer FROM public.get_account_balance_history(
  '26000000-0000-0000-0000-000000000001','2026-01-01','2026-01-31','week',
  ARRAY['36000000-0000-0000-0000-000000000002']::uuid[])), 5, 'weekly granularity and account filter work');
SELECT is((SELECT period_end FROM public.get_account_balance_history(
  '26000000-0000-0000-0000-000000000001','2026-01-02','2026-01-03','month',
  ARRAY['36000000-0000-0000-0000-000000000002']::uuid[]) LIMIT 1), '2026-01-03'::date,
  'bucket is clipped to requested range');
SELECT throws_ok($$SELECT * FROM public.get_account_balance_history(
  '26000000-0000-0000-0000-000000000001','2026-01-03','2026-01-01','day',NULL)$$,
  'P0001', 'Некорректный диапазон дат', 'invalid date range is rejected');
SELECT throws_ok($$SELECT * FROM public.get_account_balance_history(
  '26000000-0000-0000-0000-000000000001','2026-01-01','2026-01-03','quarter',NULL)$$,
  'P0001', 'Допустимая детализация: day, week или month', 'invalid granularity is rejected');
SELECT throws_ok($$SELECT * FROM public.get_account_balance_history(
  '26000000-0000-0000-0000-000000000001','2026-01-01','2026-01-03','day',
  ARRAY['aaaaaaaa-0000-0000-0000-000000000001']::uuid[])$$,
  'P0001', 'Один или несколько счетов не принадлежат рабочему пространству', 'foreign account filter is rejected');

SELECT set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000003', true);
SELECT throws_ok($$SELECT * FROM public.get_account_balance_history(
  '26000000-0000-0000-0000-000000000001','2026-01-01','2026-01-03','day',NULL)$$,
  'P0001', 'Нет доступа к рабочему пространству', 'non-member cannot read balance history');

SELECT * FROM finish();
ROLLBACK;
