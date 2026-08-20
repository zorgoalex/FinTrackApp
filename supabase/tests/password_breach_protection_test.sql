BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;

SELECT plan(14);

SELECT has_table('public', 'password_policy_proofs', 'password proofs table exists');
SELECT has_function('public', 'enforce_password_policy_proof', ARRAY[]::text[], 'password proof trigger function exists');
SELECT has_trigger('auth', 'users', 'enforce_password_policy_proof_trigger', 'auth password writes are protected');
SELECT ok(NOT has_table_privilege('anon', 'public.password_policy_proofs', 'SELECT'), 'anonymous clients cannot read proofs');
SELECT ok(NOT has_table_privilege('authenticated', 'public.password_policy_proofs', 'SELECT'), 'authenticated clients cannot read proofs');

SELECT throws_ok(
  $$
    INSERT INTO auth.users (id, email, encrypted_password, raw_user_meta_data)
    VALUES (
      'fb000000-0000-0000-0000-000000000001',
      'direct-password@example.test',
      'direct-password-hash',
      '{"username":"direct_password"}'::jsonb
    )
  $$,
  'P0001',
  'Password rejected by security policy',
  'direct password signup without an Edge proof is rejected'
);

INSERT INTO public.password_policy_proofs (token, purpose, email, expires_at)
VALUES (
  'fb100000-0000-0000-0000-000000000001',
  'signup',
  'protected-password@example.test',
  clock_timestamp() + interval '1 minute'
);

SELECT lives_ok(
  $$
    INSERT INTO auth.users (id, email, encrypted_password, raw_user_meta_data)
    VALUES (
      'fb000000-0000-0000-0000-000000000002',
      'protected-password@example.test',
      'protected-password-hash',
      '{"username":"protected_password","_password_policy_proof":"fb100000-0000-0000-0000-000000000001"}'::jsonb
    )
  $$,
  'password signup with a matching one-time proof succeeds'
);

SELECT is(
  (SELECT raw_user_meta_data->>'_password_policy_proof' FROM auth.users WHERE id = 'fb000000-0000-0000-0000-000000000002'),
  NULL,
  'signup proof is stripped from user metadata'
);

SELECT lives_ok(
  $$
    INSERT INTO auth.users (id, email, encrypted_password, raw_user_meta_data)
    VALUES (
      'fb000000-0000-0000-0000-000000000003',
      'passwordless@example.test',
      NULL,
      '{"username":"passwordless"}'::jsonb
    )
  $$,
  'passwordless and OAuth-style users remain allowed'
);

SELECT throws_ok(
  $$
    UPDATE auth.users
    SET encrypted_password = 'bypass-update-hash'
    WHERE id = 'fb000000-0000-0000-0000-000000000002'
  $$,
  'P0001',
  'Password rejected by security policy',
  'direct password update without an Edge proof is rejected'
);

INSERT INTO public.password_policy_proofs (token, purpose, user_id, expires_at)
VALUES (
  'fb100000-0000-0000-0000-000000000002',
  'update',
  'fb000000-0000-0000-0000-000000000002',
  clock_timestamp() + interval '1 minute'
);

SELECT lives_ok(
  $$
    UPDATE auth.users
    SET encrypted_password = 'protected-update-hash',
        raw_user_meta_data = raw_user_meta_data || '{"_password_policy_proof":"fb100000-0000-0000-0000-000000000002"}'::jsonb
    WHERE id = 'fb000000-0000-0000-0000-000000000002'
  $$,
  'password update with a matching one-time proof succeeds'
);

SELECT is(
  (SELECT raw_user_meta_data->>'_password_policy_proof' FROM auth.users WHERE id = 'fb000000-0000-0000-0000-000000000002'),
  NULL,
  'update proof is stripped from user metadata'
);

SELECT is(
  (SELECT count(*)::integer FROM public.password_policy_proofs WHERE token IN (
    'fb100000-0000-0000-0000-000000000001',
    'fb100000-0000-0000-0000-000000000002'
  )),
  0,
  'accepted proofs are consumed exactly once'
);

SELECT ok(
  has_table_privilege('service_role', 'public.password_policy_proofs', 'SELECT, INSERT, DELETE'),
  'service role can manage short-lived proofs'
);

SELECT * FROM finish();
ROLLBACK;
