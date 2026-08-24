BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;

SELECT plan(22);

SELECT ok(
  has_table_privilege('authenticated', 'public.accounts', 'SELECT, INSERT, UPDATE, DELETE'),
  'authenticated has CRUD on accounts before RLS filtering'
);
SELECT ok(
  has_table_privilege('authenticated', 'public.operations', 'SELECT, INSERT, UPDATE, DELETE'),
  'authenticated has CRUD on operations before RLS filtering'
);
SELECT ok(
  has_table_privilege('authenticated', 'public.debts', 'SELECT, INSERT, UPDATE, DELETE'),
  'authenticated has CRUD on debts before RLS filtering'
);
SELECT ok(
  has_table_privilege('authenticated', 'public.exchange_rates', 'SELECT, INSERT, UPDATE, DELETE'),
  'authenticated has CRUD on exchange rates before RLS filtering'
);
SELECT ok(
  has_table_privilege('authenticated', 'public.currencies', 'SELECT'),
  'authenticated can read the currency catalog'
);

SELECT ok(
  has_table_privilege('service_role', 'public.accounts', 'SELECT, INSERT, UPDATE, DELETE'),
  'service role has CRUD on accounts'
);
SELECT ok(
  has_table_privilege('service_role', 'public.operations', 'SELECT, INSERT, UPDATE, DELETE'),
  'service role has CRUD on operations'
);
SELECT ok(
  has_table_privilege('service_role', 'public.debts', 'SELECT, INSERT, UPDATE, DELETE'),
  'service role has CRUD on debts'
);
SELECT ok(
  has_table_privilege('service_role', 'public.exchange_rates', 'SELECT, INSERT, UPDATE, DELETE'),
  'service role has CRUD on exchange rates'
);
SELECT ok(
  has_table_privilege('service_role', 'public.currencies', 'SELECT'),
  'service role can read the currency catalog'
);

SELECT ok(
  has_table_privilege('authenticated', 'public.counterparties', 'DELETE'),
  'authenticated delete attempts reach counterparty RLS'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'counterparties'
      AND cmd IN ('DELETE', 'ALL')
  ),
  0,
  'counterparties expose no authenticated delete policy'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.accounts', 'SELECT'),
  'anonymous users cannot select accounts'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.operations', 'SELECT'),
  'anonymous users cannot select operations'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.debts', 'SELECT'),
  'anonymous users cannot select debts'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.exchange_rates', 'SELECT'),
  'anonymous users cannot select exchange rates'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.currencies', 'SELECT'),
  'anonymous users cannot select the currency catalog'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee = 'anon'
  ),
  0,
  'anonymous role has no public table privileges'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_class sequence
    JOIN pg_namespace namespace ON namespace.oid = sequence.relnamespace
    WHERE namespace.nspname = 'public'
      AND sequence.relkind = 'S'
      AND (
        has_sequence_privilege('anon', sequence.oid, 'SELECT')
        OR has_sequence_privilege('anon', sequence.oid, 'USAGE')
        OR has_sequence_privilege('anon', sequence.oid, 'UPDATE')
      )
  ),
  0,
  'anonymous role has no public sequence privileges'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.prokind IN ('f', 'p')
      AND has_function_privilege('anon', procedure.oid, 'EXECUTE')
  ),
  0,
  'anonymous role cannot execute public functions'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.create_user_profile()', 'EXECUTE'),
  'authenticated cannot execute the profile trigger function directly'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.protect_operation_reconciliation()', 'EXECUTE'),
  'authenticated cannot execute the reconciliation trigger function directly'
);

SELECT * FROM finish();
ROLLBACK;
