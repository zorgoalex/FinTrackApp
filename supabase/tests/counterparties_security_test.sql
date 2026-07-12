BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;

SELECT plan(16);

INSERT INTO auth.users (id, email)
VALUES
  ('11000000-0000-0000-0000-000000000001', 'counterparty-owner@example.test'),
  ('11000000-0000-0000-0000-000000000002', 'counterparty-member@example.test'),
  ('11000000-0000-0000-0000-000000000003', 'counterparty-viewer@example.test'),
  ('11000000-0000-0000-0000-000000000004', 'counterparty-owner-two@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspaces (id, owner_id, name, is_personal, workspace_type)
VALUES
  (
    '21000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000001',
    'Counterparty workspace one', false, 'business'
  ),
  (
    '21000000-0000-0000-0000-000000000002',
    '11000000-0000-0000-0000-000000000004',
    'Counterparty workspace two', false, 'business'
  );

INSERT INTO public.workspace_members (workspace_id, user_id, role)
VALUES
  ('21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'Owner'),
  ('21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000002', 'Member'),
  ('21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000003', 'Viewer'),
  ('21000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000004', 'Owner');

INSERT INTO public.categories (id, workspace_id, name, type)
VALUES
  ('31000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'Fixture expense one', 'expense'),
  ('31000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000002', 'Fixture expense two', 'expense');

INSERT INTO public.counterparties (
  id, workspace_id, kind, display_name, tax_id, created_by
)
VALUES
  (
    '41000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000001',
    'supplier', 'Source Company', '12-34 56',
    '11000000-0000-0000-0000-000000000001'
  ),
  (
    '41000000-0000-0000-0000-000000000002',
    '21000000-0000-0000-0000-000000000001',
    'both', 'Target Company', '987654',
    '11000000-0000-0000-0000-000000000001'
  ),
  (
    '41000000-0000-0000-0000-000000000003',
    '21000000-0000-0000-0000-000000000002',
    'customer', 'Other Workspace Company', NULL,
    '11000000-0000-0000-0000-000000000004'
  ),
  (
    '41000000-0000-0000-0000-000000000004',
    '21000000-0000-0000-0000-000000000001',
    'customer', 'Member Merge Source', NULL,
    '11000000-0000-0000-0000-000000000001'
  );

INSERT INTO public.operations (
  id, workspace_id, user_id, amount, type, description, operation_date,
  category_id, account_id, counterparty_id, currency, exchange_rate, base_amount
)
VALUES (
  '51000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  100, 'expense', 'Counterparty fixture operation', CURRENT_DATE,
  '31000000-0000-0000-0000-000000000001',
  (SELECT id FROM public.accounts
   WHERE workspace_id = '21000000-0000-0000-0000-000000000001' AND is_default),
  '41000000-0000-0000-0000-000000000001', 'KZT', 1, 100
);

INSERT INTO public.debts (
  id, workspace_id, created_by, title, counterparty, counterparty_id,
  direction, initial_amount, currency
)
VALUES (
  '61000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  'Counterparty fixture debt', 'Source Company',
  '41000000-0000-0000-0000-000000000001', 'i_owe', 100, 'KZT'
);

SELECT has_table('public', 'counterparties', 'counterparties table exists');
SELECT has_column('public', 'operations', 'counterparty_id', 'operations link exists');
SELECT has_column('public', 'debts', 'counterparty_id', 'debts link exists');

SELECT throws_ok(
  $$INSERT INTO public.counterparties (workspace_id, display_name, created_by)
    VALUES (
      '21000000-0000-0000-0000-000000000001', '  SOURCE   company ',
      '11000000-0000-0000-0000-000000000001'
    )$$,
  '23505',
  'duplicate key value violates unique constraint "counterparties_workspace_normalized_name_key"',
  'normalized name is unique per workspace'
);

SELECT throws_ok(
  $$INSERT INTO public.counterparties (workspace_id, display_name, tax_id, created_by)
    VALUES (
      '21000000-0000-0000-0000-000000000001', 'Different name', '123 456',
      '11000000-0000-0000-0000-000000000001'
    )$$,
  '23505',
  'duplicate key value violates unique constraint "counterparties_workspace_normalized_tax_id_key"',
  'normalized tax id is unique per workspace'
);

SELECT throws_ok(
  $$INSERT INTO public.operations (
      workspace_id, user_id, amount, type, category_id, account_id,
      currency, exchange_rate, base_amount
    ) VALUES (
      '21000000-0000-0000-0000-000000000001',
      '11000000-0000-0000-0000-000000000001', 10, 'expense',
      '31000000-0000-0000-0000-000000000002',
      (SELECT id FROM public.accounts
       WHERE workspace_id = '21000000-0000-0000-0000-000000000001' AND is_default),
      'KZT', 1, 10
    )$$,
  '23503',
  'insert or update on table "operations" violates foreign key constraint "operations_category_workspace_fkey"',
  'operation cannot use another workspace category'
);

SELECT throws_ok(
  $$INSERT INTO public.scheduled_operations (
      workspace_id, user_id, amount, type, category_id, account_id,
      frequency, next_date, currency
    ) VALUES (
      '21000000-0000-0000-0000-000000000001',
      '11000000-0000-0000-0000-000000000001', 10, 'expense',
      '31000000-0000-0000-0000-000000000002',
      (SELECT id FROM public.accounts
       WHERE workspace_id = '21000000-0000-0000-0000-000000000001' AND is_default),
      'monthly', CURRENT_DATE, 'KZT'
    )$$,
  '23503',
  'insert or update on table "scheduled_operations" violates foreign key constraint "scheduled_operations_category_workspace_fkey"',
  'schedule cannot use another workspace category'
);

SELECT throws_ok(
  $$UPDATE public.operations
    SET counterparty_id = '41000000-0000-0000-0000-000000000003'
    WHERE id = '51000000-0000-0000-0000-000000000001'$$,
  'P0001', 'Контрагент не найден или находится в архиве',
  'operation cannot use another workspace counterparty'
);

SELECT throws_ok(
  $$UPDATE public.debts
    SET counterparty_id = '41000000-0000-0000-0000-000000000003'
    WHERE id = '61000000-0000-0000-0000-000000000001'$$,
  'P0001', 'Контрагент не найден или находится в архиве',
  'debt cannot use another workspace counterparty'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000002', true);
SELECT throws_ok(
  $$SELECT public.merge_counterparties(
      '41000000-0000-0000-0000-000000000004',
      '41000000-0000-0000-0000-000000000002'
    )$$,
  'P0001', 'Только владелец или администратор может объединять контрагентов',
  'member cannot merge counterparties'
);

SELECT set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000003', true);
SELECT throws_ok(
  $$INSERT INTO public.counterparties (workspace_id, display_name, created_by)
    VALUES (
      '21000000-0000-0000-0000-000000000001', 'Viewer write',
      '11000000-0000-0000-0000-000000000003'
    )$$,
  '42501', NULL,
  'viewer cannot create counterparties'
);

SELECT set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000001', true);
SELECT lives_ok(
  $$SELECT public.merge_counterparties(
      '41000000-0000-0000-0000-000000000001',
      '41000000-0000-0000-0000-000000000002'
    )$$,
  'owner can merge counterparties'
);

SELECT ok(
  (SELECT is_archived AND merged_into_id = '41000000-0000-0000-0000-000000000002'
   FROM public.counterparties
   WHERE id = '41000000-0000-0000-0000-000000000001'),
  'merge archives source and records target'
);
SELECT is(
  (SELECT counterparty_id FROM public.operations
   WHERE id = '51000000-0000-0000-0000-000000000001'),
  '41000000-0000-0000-0000-000000000002'::uuid,
  'merge relinks operations'
);
SELECT is(
  (SELECT counterparty_id FROM public.debts
   WHERE id = '61000000-0000-0000-0000-000000000001'),
  '41000000-0000-0000-0000-000000000002'::uuid,
  'merge relinks debts'
);

SELECT is_empty(
  $$DELETE FROM public.counterparties
    WHERE id = '41000000-0000-0000-0000-000000000002'
    RETURNING id$$,
  'authenticated users cannot physically delete counterparties'
);

SELECT * FROM finish();
ROLLBACK;
