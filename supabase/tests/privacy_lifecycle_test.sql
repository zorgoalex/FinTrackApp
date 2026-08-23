BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(26);

SELECT has_function('public', 'purge_expired_privacy_data', ARRAY[]::text[], 'privacy retention function exists');
SELECT has_trigger('auth', 'users', 'cleanup_account_privacy_before_delete', 'account deletion removes email-linked privacy data');
SELECT ok(NOT has_function_privilege('anon', 'public.purge_expired_privacy_data()', 'EXECUTE'), 'anonymous role cannot run retention cleanup');
SELECT ok(NOT has_function_privilege('authenticated', 'public.purge_expired_privacy_data()', 'EXECUTE'), 'authenticated role cannot run retention cleanup');
SELECT ok(has_function_privilege('service_role', 'public.purge_expired_privacy_data()', 'EXECUTE'), 'service role can run retention cleanup');
SELECT ok(NOT has_table_privilege('authenticated', 'public.ai_assistant_logs', 'INSERT'), 'browser cannot insert arbitrary AI logs');

INSERT INTO auth.users(id, email) VALUES
  ('31000000-0000-4000-8000-000000000001', 'privacy-user@example.test'),
  ('31000000-0000-4000-8000-000000000002', 'privacy-owner@example.test');

INSERT INTO auth.sessions(id, user_id)
VALUES ('31000000-0000-4000-8000-000000000099', '31000000-0000-4000-8000-000000000001');

INSERT INTO public.workspaces(id, owner_id, name, is_personal, workspace_type, base_currency)
VALUES ('32000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000002', 'Privacy retention', false, 'business', 'KZT');

INSERT INTO public.workspace_members(workspace_id, user_id, role) VALUES
  ('32000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000002', 'Owner'),
  ('32000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', 'Member');

SELECT throws_like(
  $$INSERT INTO public.ai_assistant_logs(workspace_id, user_id, question, model, status)
    VALUES ('32000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', 'raw private question', 'test', 'mock')$$,
  '%ai_assistant_logs_question_fingerprint_check%',
  'AI logs reject plaintext questions'
);

INSERT INTO public.ai_assistant_logs(id, workspace_id, user_id, question, model, status, created_at) VALUES
  ('33000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', 'sha256:' || repeat('a', 64), 'test', 'mock', clock_timestamp() - interval '31 days'),
  ('33000000-0000-4000-8000-000000000002', '32000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', 'sha256:' || repeat('b', 64), 'test', 'mock', clock_timestamp());

INSERT INTO public.workspace_invitations(id, workspace_id, invited_by, invited_email, role, status, invited_at, expires_at, accepted_at, created_at, updated_at) VALUES
  ('34000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000002', 'old-invite@example.test', 'Member', 'accepted', clock_timestamp() - interval '45 days', clock_timestamp() - interval '38 days', clock_timestamp() - interval '37 days', clock_timestamp() - interval '45 days', clock_timestamp() - interval '37 days'),
  ('34000000-0000-4000-8000-000000000002', '32000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000002', 'fresh-invite@example.test', 'Member', 'pending', clock_timestamp(), clock_timestamp() + interval '7 days', NULL, clock_timestamp(), clock_timestamp());

INSERT INTO public.telegram_link_tokens(id, user_id, token_hash, expires_at, used_at, created_at) VALUES
  ('35000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', repeat('c', 64), clock_timestamp() - interval '2 days', NULL, clock_timestamp() - interval '3 days'),
  ('35000000-0000-4000-8000-000000000002', '31000000-0000-4000-8000-000000000001', repeat('d', 64), clock_timestamp() + interval '10 minutes', NULL, clock_timestamp());

INSERT INTO public.password_policy_proofs(token, purpose, email, expires_at, created_at) VALUES
  ('36000000-0000-4000-8000-000000000001', 'signup', 'old-proof@example.test', clock_timestamp() - interval '1 minute', clock_timestamp() - interval '2 minutes'),
  ('36000000-0000-4000-8000-000000000002', 'signup', 'fresh-proof@example.test', clock_timestamp() + interval '1 minute', clock_timestamp());

INSERT INTO public.security_rate_limits(bucket, subject, window_started_at, request_count, expires_at) VALUES
  ('privacy:test', 'old-subject', clock_timestamp() - interval '1 hour', 1, clock_timestamp() - interval '1 minute'),
  ('privacy:test', 'fresh-subject', clock_timestamp(), 1, clock_timestamp() + interval '1 hour');

INSERT INTO public.telegram_webhook_updates(update_id, received_at) VALUES
  (9100001, clock_timestamp() - interval '8 days'),
  (9100002, clock_timestamp());

INSERT INTO private.financial_write_requests(workspace_id, user_id, request_id, request_kind, payload_hash, result, created_at, expires_at) VALUES
  ('32000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000001', 'operation', repeat('e', 64), '{}'::jsonb, clock_timestamp() - interval '8 days', clock_timestamp() - interval '1 day'),
  ('32000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000002', 'operation', repeat('f', 64), '{}'::jsonb, clock_timestamp(), clock_timestamp() + interval '7 days');

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT lives_ok($$SELECT public.purge_expired_privacy_data()$$, 'service role runs bounded retention cleanup');
RESET ROLE;

SELECT is((SELECT count(*)::integer FROM public.ai_assistant_logs WHERE id='33000000-0000-4000-8000-000000000001'), 0, 'old AI log is deleted');
SELECT is((SELECT count(*)::integer FROM public.ai_assistant_logs WHERE id='33000000-0000-4000-8000-000000000002'), 1, 'fresh AI log is retained');
SELECT is((SELECT count(*)::integer FROM public.workspace_invitations WHERE id='34000000-0000-4000-8000-000000000001'), 0, 'old completed invitation is deleted');
SELECT is((SELECT count(*)::integer FROM public.workspace_invitations WHERE id='34000000-0000-4000-8000-000000000002'), 1, 'fresh pending invitation is retained');
SELECT is((SELECT count(*)::integer FROM public.telegram_link_tokens WHERE id='35000000-0000-4000-8000-000000000001'), 0, 'old Telegram token is deleted');
SELECT is((SELECT count(*)::integer FROM public.telegram_link_tokens WHERE id='35000000-0000-4000-8000-000000000002'), 1, 'fresh Telegram token is retained');
SELECT is((SELECT count(*)::integer FROM public.password_policy_proofs WHERE token='36000000-0000-4000-8000-000000000001'), 0, 'expired password proof is deleted');
SELECT is((SELECT count(*)::integer FROM public.password_policy_proofs WHERE token='36000000-0000-4000-8000-000000000002'), 1, 'fresh password proof is retained');
SELECT is((SELECT count(*)::integer FROM public.security_rate_limits WHERE subject='old-subject'), 0, 'expired rate-limit bucket is deleted');
SELECT is((SELECT count(*)::integer FROM public.security_rate_limits WHERE subject='fresh-subject'), 1, 'fresh rate-limit bucket is retained');
SELECT is((SELECT count(*)::integer FROM public.telegram_webhook_updates WHERE update_id=9100001), 0, 'old Telegram update claim is deleted');
SELECT is((SELECT count(*)::integer FROM public.telegram_webhook_updates WHERE update_id=9100002), 1, 'fresh Telegram update claim is retained');
SELECT is((SELECT count(*)::integer FROM private.financial_write_requests WHERE request_id='37000000-0000-4000-8000-000000000001'), 0, 'expired financial receipt is deleted');
SELECT is((SELECT count(*)::integer FROM private.financial_write_requests WHERE request_id='37000000-0000-4000-8000-000000000002'), 1, 'fresh financial receipt is retained');

INSERT INTO public.workspace_invitations(id, workspace_id, invited_by, invited_email, role, status, invited_at, expires_at, created_at, updated_at)
VALUES ('34000000-0000-4000-8000-000000000003', '32000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000002', 'PRIVACY-USER@example.test', 'Member', 'pending', clock_timestamp(), clock_timestamp() + interval '7 days', clock_timestamp(), clock_timestamp());
INSERT INTO public.security_rate_limits(bucket, subject, window_started_at, request_count, expires_at)
VALUES ('privacy:account', 'workspace:31000000-0000-4000-8000-000000000001', clock_timestamp(), 1, clock_timestamp() + interval '1 hour');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '31000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', '31000000-0000-4000-8000-000000000001',
  'role', 'authenticated',
  'session_id', '31000000-0000-4000-8000-000000000099',
  'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch FROM now())::bigint))
)::text, true);
SELECT lives_ok(
  $$SELECT public.delete_my_account('PRIVACY-USER@example.test')$$,
  'protected account deletion runs privacy cleanup'
);
RESET ROLE;

SELECT is((SELECT count(*)::integer FROM public.workspace_invitations WHERE id='34000000-0000-4000-8000-000000000003'), 0, 'account deletion removes invitations received by email');
SELECT is((SELECT count(*)::integer FROM public.security_rate_limits WHERE subject LIKE '%31000000-0000-4000-8000-000000000001'), 0, 'account deletion removes direct UUID rate-limit subjects');
SELECT is((SELECT count(*)::integer FROM auth.users WHERE id='31000000-0000-4000-8000-000000000002'), 1, 'privacy cleanup leaves other users untouched');

SELECT * FROM finish();
ROLLBACK;
