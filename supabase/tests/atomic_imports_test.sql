BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;

SELECT plan(21);

INSERT INTO auth.users (id, email) VALUES
  ('12000000-0000-0000-0000-000000000001', 'import-owner@example.test'),
  ('12000000-0000-0000-0000-000000000002', 'import-member@example.test'),
  ('12000000-0000-0000-0000-000000000003', 'import-viewer@example.test'),
  ('12000000-0000-0000-0000-000000000004', 'import-other@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workspaces (id, owner_id, name, is_personal, workspace_type) VALUES
  ('22000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000001', 'Import workspace', false, 'business'),
  ('22000000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-000000000004', 'Other import workspace', false, 'business');

INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  ('22000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000001', 'Owner'),
  ('22000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000002', 'Member'),
  ('22000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000003', 'Viewer'),
  ('22000000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-000000000004', 'Owner');

INSERT INTO public.categories (id, workspace_id, name, type) VALUES
  ('32000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', 'Import expense', 'expense'),
  ('32000000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000002', 'Other expense', 'expense');

INSERT INTO public.counterparties (id, workspace_id, display_name, created_by) VALUES
  ('42000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', 'Import supplier', '12000000-0000-0000-0000-000000000001'),
  ('42000000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000002', 'Other supplier', '12000000-0000-0000-0000-000000000004');

SELECT has_table('public', 'import_templates', 'CSV import templates table exists');
SELECT has_function(
  'public', 'confirm_import', ARRAY['uuid', 'text', 'text', 'text', 'jsonb', 'uuid', 'jsonb', 'uuid'],
  'atomic confirm_import RPC exists'
);
SELECT ok(
  public.is_valid_import_mapping('{"date":"Дата","type":"Тип","amount":"Сумма"}'::jsonb),
  'required CSV mapping is valid'
);
SELECT ok(
  NOT public.is_valid_import_mapping('{"date":"Дата","type":"Тип","unknown":"x"}'::jsonb),
  'unknown and missing CSV mapping fields are rejected'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-000000000001', true);

SELECT lives_ok(
  $$INSERT INTO public.import_templates (
      id, workspace_id, name, mapping, settings, created_by
    ) VALUES (
      '52000000-0000-0000-0000-000000000001',
      '22000000-0000-0000-0000-000000000001', 'Kaspi CSV',
      '{"date":"Дата","type":"Тип","amount":"Сумма"}',
      '{"delimiter":";"}', '12000000-0000-0000-0000-000000000001'
    )$$,
  'owner can save a CSV template'
);

SELECT set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-000000000003', true);
SELECT throws_ok(
  $$INSERT INTO public.import_templates (workspace_id, name, mapping, created_by)
    VALUES (
      '22000000-0000-0000-0000-000000000001', 'Viewer template',
      '{"date":0,"type":1,"amount":2}', '12000000-0000-0000-0000-000000000003'
    )$$,
  '42501', NULL, 'viewer cannot save an import template'
);

SELECT throws_ok(
  $$SELECT public.confirm_import(
      '22000000-0000-0000-0000-000000000001', 'csv', 'csv', repeat('a', 64),
      '[{"amount":10}]', NULL, '{}', '62000000-0000-0000-0000-000000000001'
    )$$,
  'P0001', 'Нет права импортировать операции', 'viewer cannot confirm an import'
);

SELECT set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-000000000002', true);
SELECT lives_ok(
  $$SELECT public.confirm_import(
      '22000000-0000-0000-0000-000000000001', 'csv', 'csv', repeat('b', 64),
      jsonb_build_array(
        jsonb_build_object(
          'type', 'expense', 'amount', 125.50, 'operation_date', CURRENT_DATE,
          'currency', 'KZT', 'exchange_rate', 1, 'base_amount', 125.50,
          'account_id', (SELECT id FROM public.accounts WHERE workspace_id = '22000000-0000-0000-0000-000000000001' AND is_default),
          'category_id', '32000000-0000-0000-0000-000000000001',
          'counterparty_id', '42000000-0000-0000-0000-000000000001',
          'description', 'Atomic import fixture', 'import_fingerprint', repeat('c', 64),
          'import_confidence', 0.9, 'receipt_items_comment', 'Coffee 1 x 125.50',
          'remember_rule', true, 'rule_pattern', 'atomic fixture'
        ),
        jsonb_build_object('selected', false)
      ),
      '52000000-0000-0000-0000-000000000001', '{"parser":"csv-v1"}',
      '62000000-0000-0000-0000-000000000002'
    )$$,
  'member atomically confirms valid rows'
);

SELECT lives_ok(
  $$SET CONSTRAINTS operation_allocation_totals_from_operation IMMEDIATE$$,
  'deferred allocation trigger accepts a regular imported operation'
);

SELECT is(
  (SELECT status FROM public.operations WHERE import_fingerprint = repeat('c', 64)),
  'new', 'imported operation starts in new status'
);
SELECT is(
  (SELECT confirmed_count FROM public.import_sessions WHERE request_id = '62000000-0000-0000-0000-000000000002'),
  1, 'session stores exact confirmed count'
);
SELECT is(
  (SELECT result ->> 'skipped_count' FROM public.import_sessions WHERE request_id = '62000000-0000-0000-0000-000000000002'),
  '1', 'session result stores exact skipped count'
);
SELECT is(
  (SELECT count(*)::integer FROM public.operation_comments comment
   JOIN public.operations operation ON operation.id = comment.operation_id
   WHERE operation.import_fingerprint = repeat('c', 64) AND comment.kind = 'receipt_items'),
  1, 'receipt item comment is committed with the operation'
);
SELECT is(
  (SELECT count(*)::integer FROM public.category_rules
   WHERE workspace_id = '22000000-0000-0000-0000-000000000001'
     AND operation_type = 'expense' AND pattern = 'atomic fixture'),
  1, 'opted-in category rule is committed with the operation'
);

SELECT lives_ok(
  $$SELECT public.confirm_import(
      '22000000-0000-0000-0000-000000000001', 'csv', 'csv', repeat('b', 64),
      jsonb_build_array(jsonb_build_object('selected', false)),
      NULL, '{}', '62000000-0000-0000-0000-000000000002'
    )$$,
  'same request id returns the stored result without reprocessing payload'
);
SELECT is(
  (SELECT count(*)::integer FROM public.import_sessions
   WHERE request_id = '62000000-0000-0000-0000-000000000002'),
  1, 'request retry does not create another session'
);

SELECT lives_ok(
  $$SELECT public.confirm_import(
      '22000000-0000-0000-0000-000000000001', 'csv', 'csv', repeat('d', 64),
      jsonb_build_array(jsonb_build_object(
        'type', 'expense', 'amount', 125.50, 'operation_date', CURRENT_DATE,
        'currency', 'KZT', 'account_id', (SELECT id FROM public.accounts WHERE workspace_id = '22000000-0000-0000-0000-000000000001' AND is_default),
        'import_fingerprint', repeat('c', 64)
      )), NULL, '{}', '62000000-0000-0000-0000-000000000003'
    )$$,
  'a different request handles an existing fingerprint race-safely'
);
SELECT is(
  (SELECT duplicate_count FROM public.import_sessions WHERE request_id = '62000000-0000-0000-0000-000000000003'),
  1, 'duplicate count is exact'
);

SELECT throws_ok(
  $$UPDATE public.import_sessions SET status = 'partial'
    WHERE request_id = '62000000-0000-0000-0000-000000000002'$$,
  '42501', NULL, 'authenticated users cannot mutate import sessions directly'
);

SELECT throws_ok(
  $$SELECT public.confirm_import(
      '22000000-0000-0000-0000-000000000001', 'csv', 'csv', repeat('e', 64),
      jsonb_build_array(
        jsonb_build_object(
          'type', 'expense', 'amount', 10, 'operation_date', CURRENT_DATE,
          'currency', 'KZT', 'account_id', (SELECT id FROM public.accounts WHERE workspace_id = '22000000-0000-0000-0000-000000000001' AND is_default),
          'import_fingerprint', repeat('f', 64)
        ),
        jsonb_build_object(
          'type', 'expense', 'amount', 10, 'operation_date', CURRENT_DATE,
          'currency', 'KZT', 'account_id', (SELECT id FROM public.accounts WHERE workspace_id = '22000000-0000-0000-0000-000000000002' AND is_default),
          'import_fingerprint', repeat('1', 64)
        )
      ), NULL, '{}', '62000000-0000-0000-0000-000000000004'
    )$$,
  'P0001', 'Счёт не найден, архивирован или имеет другую валюту в строке 2',
  'cross-workspace row aborts the whole import'
);
SELECT is(
  (SELECT count(*)::integer FROM public.operations WHERE import_fingerprint = repeat('f', 64)),
  0, 'failed import rolls back previously inserted rows'
);

SELECT * FROM finish();
ROLLBACK;
