BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;

SELECT plan(21);

SELECT has_schema('private', 'private schema exists');
SELECT has_table('private', 'security_events', 'private security event table exists');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'private.security_events'::regclass),
  'security event table has RLS enabled'
);

SELECT ok(NOT has_schema_privilege('anon', 'private', 'USAGE'), 'anonymous role cannot use private schema');
SELECT ok(NOT has_schema_privilege('authenticated', 'private', 'USAGE'), 'authenticated role cannot use private schema');
SELECT ok(NOT has_schema_privilege('service_role', 'private', 'USAGE'), 'service role cannot use private schema directly');
SELECT ok(NOT has_table_privilege('anon', 'private.security_events', 'SELECT'), 'anonymous role cannot read security events');
SELECT ok(NOT has_table_privilege('authenticated', 'private.security_events', 'SELECT'), 'authenticated role cannot read security events');
SELECT ok(NOT has_table_privilege('service_role', 'private.security_events', 'SELECT'), 'service role cannot read security events directly');

SELECT ok(
  NOT has_function_privilege('anon', 'public.record_security_event(text,text,uuid,uuid,uuid,text,text,text,jsonb)', 'EXECUTE'),
  'anonymous role cannot write security events'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.record_security_event(text,text,uuid,uuid,uuid,text,text,text,jsonb)', 'EXECUTE'),
  'authenticated role cannot write security events directly'
);
SELECT ok(
  has_function_privilege('service_role', 'public.record_security_event(text,text,uuid,uuid,uuid,text,text,text,jsonb)', 'EXECUTE'),
  'service role can use the restricted event writer'
);
SELECT ok(
  has_function_privilege('service_role', 'public.purge_security_events()', 'EXECUTE'),
  'service role can run bounded retention cleanup'
);

SELECT has_trigger('public', 'workspace_members', 'audit_workspace_member_change', 'member changes are audited');
SELECT has_trigger('public', 'workspaces', 'audit_workspace_soft_delete', 'workspace deletion is audited');
SELECT has_trigger('public', 'workspace_invitations', 'audit_invitation_status_change', 'invitation cancellation is audited');
SELECT has_trigger('public', 'workspace_invitations', 'audit_invitation_delete', 'deleted pending invitations are audited');

INSERT INTO private.security_events(event_type, outcome, source, occurred_at)
VALUES ('monitor.test_old', 'success', 'monitor', clock_timestamp() - interval '91 days');

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT lives_ok(
  $$ SELECT public.record_security_event(
    'auth.login', 'success',
    '11111111-1111-4111-8111-111111111111'::uuid, NULL::uuid, NULL::uuid,
    repeat('a', 64), 'request-1', 'edge', '{"method":"password"}'::jsonb
  ) $$,
  'service writer accepts a bounded redacted event'
);
SELECT throws_ok(
  $$ SELECT public.record_security_event(
    'auth.login', 'failure', NULL::uuid, NULL::uuid, NULL::uuid,
    repeat('b', 64), NULL::text, 'edge', '{"password":"never-store-this"}'::jsonb
  ) $$,
  'Sensitive or invalid security event metadata',
  'sensitive metadata is rejected'
);
RESET ROLE;

SELECT is(
  (SELECT count(*)::integer FROM private.security_events WHERE event_type = 'auth.login'),
  1,
  'accepted event is stored once'
);
SELECT is(
  (SELECT count(*)::integer FROM private.security_events WHERE event_type = 'monitor.test_old'),
  0,
  'writer deletes events older than 90 days'
);

SELECT * FROM finish();
ROLLBACK;
