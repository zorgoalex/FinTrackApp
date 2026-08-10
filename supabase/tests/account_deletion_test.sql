BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(11);

INSERT INTO auth.users(id, email) VALUES
  ('1a000000-0000-0000-0000-000000000001', 'delete-me@example.test'),
  ('1a000000-0000-0000-0000-000000000002', 'shared-owner@example.test');

INSERT INTO auth.sessions(id, user_id) VALUES
  ('1a000000-0000-0000-0000-000000000099', '1a000000-0000-0000-0000-000000000001');

INSERT INTO public.workspaces(id, owner_id, name, is_personal, workspace_type, base_currency) VALUES
  ('2a000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000001', 'Owned by deleting user', false, 'business', 'KZT'),
  ('2a000000-0000-0000-0000-000000000002', '1a000000-0000-0000-0000-000000000002', 'Shared surviving workspace', false, 'business', 'KZT');

INSERT INTO public.workspace_members(workspace_id, user_id, role) VALUES
  ('2a000000-0000-0000-0000-000000000001', '1a000000-0000-0000-0000-000000000001', 'Owner'),
  ('2a000000-0000-0000-0000-000000000002', '1a000000-0000-0000-0000-000000000002', 'Owner'),
  ('2a000000-0000-0000-0000-000000000002', '1a000000-0000-0000-0000-000000000001', 'Member');

INSERT INTO public.counterparties(id, workspace_id, display_name, created_by) VALUES
  ('3a000000-0000-0000-0000-000000000001', '2a000000-0000-0000-0000-000000000002', 'Shared counterparty', '1a000000-0000-0000-0000-000000000001');

SELECT has_function('public', 'delete_my_account', ARRAY['text'], 'self-service account deletion RPC exists');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '1a000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '1a000000-0000-0000-0000-000000000001',
  'role', 'authenticated',
  'aal', 'aal1',
  'session_id', '1a000000-0000-0000-0000-000000000099',
  'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch FROM now())::bigint))
)::text, true);

SELECT throws_ok(
  $$SELECT public.delete_my_account('delete-me@example.test')$$,
  'P0001', 'Подтвердите действие свежим кодом TOTP',
  'account deletion rejects AAL1 even after a fresh password'
);

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '1a000000-0000-0000-0000-000000000001',
  'role', 'authenticated',
  'aal', 'aal2',
  'session_id', '1a000000-0000-0000-0000-000000000099',
  'amr', json_build_array(
    json_build_object('method', 'password', 'timestamp', extract(epoch FROM now() - interval '10 minutes')::bigint),
    json_build_object('method', 'mfa/totp', 'timestamp', extract(epoch FROM now())::bigint)
  )
)::text, true);

SELECT throws_ok(
  $$SELECT public.delete_my_account('delete-me@example.test')$$,
  'P0001', 'Повторно подтвердите текущий пароль',
  'account deletion rejects a stale password session'
);

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '1a000000-0000-0000-0000-000000000001',
  'role', 'authenticated',
  'aal', 'aal2',
  'session_id', '1a000000-0000-0000-0000-000000000099',
  'amr', json_build_array(
    json_build_object('method', 'password', 'timestamp', extract(epoch FROM now())::bigint),
    json_build_object('method', 'mfa/totp', 'timestamp', extract(epoch FROM now())::bigint)
  )
)::text, true);

SELECT throws_ok(
  $$SELECT public.delete_my_account('wrong@example.test')$$,
  'P0001', 'Для подтверждения введите email текущего аккаунта',
  'account deletion requires the current email'
);
SELECT lives_ok(
  $$SELECT public.delete_my_account('DELETE-ME@example.test')$$,
  'account deletion is atomic and case-insensitive'
);

RESET ROLE;
SELECT is((SELECT count(*)::integer FROM auth.users WHERE id='1a000000-0000-0000-0000-000000000001'), 0, 'auth user is deleted');
SELECT is((SELECT count(*)::integer FROM public.workspaces WHERE id='2a000000-0000-0000-0000-000000000001'), 0, 'owned workspace is deleted');
SELECT is((SELECT count(*)::integer FROM public.workspaces WHERE id='2a000000-0000-0000-0000-000000000002'), 1, 'shared workspace survives');
SELECT is((SELECT count(*)::integer FROM public.workspace_members WHERE user_id='1a000000-0000-0000-0000-000000000001'), 0, 'memberships are deleted');
SELECT is((SELECT created_by FROM public.counterparties WHERE id='3a000000-0000-0000-0000-000000000001'), '1a000000-0000-0000-0000-000000000002'::uuid, 'shared authorship transfers to workspace owner');
SELECT is((SELECT count(*)::integer FROM auth.users WHERE id='1a000000-0000-0000-0000-000000000002'), 1, 'other users are untouched');

SELECT * FROM finish();
ROLLBACK;
