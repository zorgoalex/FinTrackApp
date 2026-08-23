BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(17);

SELECT has_function('public', 'authorize_my_privacy_export', ARRAY[]::text[], 'privacy export authorization exists');
SELECT has_function('public', 'get_my_privacy_security_events', ARRAY[]::text[], 'privacy event projection exists');
SELECT ok(NOT has_function_privilege('anon', 'public.authorize_my_privacy_export()', 'EXECUTE'), 'anonymous role cannot authorize export');
SELECT ok(has_function_privilege('authenticated', 'public.authorize_my_privacy_export()', 'EXECUTE'), 'authenticated role can request export authorization');
SELECT ok(NOT has_function_privilege('service_role', 'public.authorize_my_privacy_export()', 'EXECUTE'), 'service role cannot impersonate a user export');
SELECT ok(NOT has_function_privilege('anon', 'public.get_my_privacy_security_events()', 'EXECUTE'), 'anonymous role cannot read privacy events');
SELECT ok(has_function_privilege('authenticated', 'public.get_my_privacy_security_events()', 'EXECUTE'), 'authenticated role can read its redacted events');
SELECT ok(NOT has_function_privilege('service_role', 'public.get_my_privacy_security_events()', 'EXECUTE'), 'service role cannot call user privacy projection');

INSERT INTO auth.users(id, email) VALUES
  ('41000000-0000-4000-8000-000000000001', 'export-user@example.test'),
  ('41000000-0000-4000-8000-000000000002', 'export-other@example.test');
INSERT INTO auth.sessions(id, user_id) VALUES
  ('41000000-0000-4000-8000-000000000099', '41000000-0000-4000-8000-000000000001');

INSERT INTO private.security_events(event_type, outcome, actor_user_id, target_user_id, source, metadata) VALUES
  ('data.export.operations', 'success', '41000000-0000-4000-8000-000000000001', NULL, 'client', '{"format":"csv"}'),
  ('workspace.role_change', 'success', '41000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000001', 'database', '{"new_role":"Member"}'),
  ('auth.login', 'failure', '41000000-0000-4000-8000-000000000002', NULL, 'edge', '{}');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '41000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '41000000-0000-4000-8000-000000000001',
  'role', 'authenticated',
  'session_id', '41000000-0000-4000-8000-000000000099',
  'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch FROM now() - interval '6 minutes')::bigint))
)::text, true);

SELECT throws_like(
  $$SELECT public.authorize_my_privacy_export()$$,
  '%Повторно подтвердите текущий пароль%',
  'stale password session cannot authorize export'
);
SELECT throws_like(
  $$SELECT * FROM public.get_my_privacy_security_events()$$,
  '%Повторно подтвердите текущий пароль%',
  'stale password session cannot read event projection'
);

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '41000000-0000-4000-8000-000000000001',
  'role', 'authenticated',
  'session_id', '41000000-0000-4000-8000-000000000099',
  'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch FROM now())::bigint))
)::text, true);

SELECT is(public.authorize_my_privacy_export(), true, 'fresh password session authorizes export');
SELECT is((SELECT count(*)::integer FROM public.get_my_privacy_security_events()), 2, 'projection contains only events involving current user');
SELECT is((SELECT count(*)::integer FROM public.get_my_privacy_security_events() WHERE relation = 'actor'), 1, 'actor relation is redacted and retained');
SELECT is((SELECT count(*)::integer FROM public.get_my_privacy_security_events() WHERE relation = 'target'), 1, 'target relation is redacted and retained');
SELECT is((SELECT count(*)::integer FROM public.get_my_privacy_security_events() WHERE event_type = 'auth.login'), 0, 'unrelated event is not exposed');
SELECT is((SELECT count(*)::integer FROM public.get_my_privacy_security_events() WHERE metadata ? 'format'), 1, 'safe scalar event metadata is retained');
SELECT ok(
  pg_get_function_result('public.get_my_privacy_security_events()'::regprocedure)
    !~ '(actor_user_id|target_user_id|subject_hash|request_id)',
  'projection result does not expose security identifiers'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
