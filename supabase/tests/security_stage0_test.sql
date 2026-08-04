BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(12);

SELECT has_table('public', 'security_rate_limits', 'security rate limit buckets exist');
SELECT has_function('public', 'consume_security_rate_limit', ARRAY['text','text','integer','integer'], 'atomic rate limit RPC exists');
SELECT has_table('public', 'telegram_webhook_updates', 'Telegram replay claims exist');
SELECT has_function('public', 'claim_telegram_webhook_update', ARRAY['bigint'], 'Telegram claim RPC exists');

SELECT ok(public.is_allowed_web_push_endpoint('https://fcm.googleapis.com/fcm/send/abc'), 'FCM endpoint is allowed');
SELECT ok(public.is_allowed_web_push_endpoint('https://updates.push.services.mozilla.com/wpush/v2/abc'), 'Mozilla endpoint is allowed');
SELECT ok(NOT public.is_allowed_web_push_endpoint('https://127.0.0.1/internal'), 'loopback push endpoint is rejected');
SELECT ok(NOT public.is_allowed_web_push_endpoint('https://example.test/push'), 'arbitrary push host is rejected');

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT ok(public.consume_security_rate_limit('test:stage0', 'subject-a', 1, 60), 'first request is allowed');
SELECT ok(NOT public.consume_security_rate_limit('test:stage0', 'subject-a', 1, 60), 'request over the limit is rejected');
SELECT ok(public.claim_telegram_webhook_update(990000000001), 'first Telegram update claim succeeds');
SELECT ok(NOT public.claim_telegram_webhook_update(990000000001), 'duplicate Telegram update claim is rejected');

SELECT * FROM finish();
ROLLBACK;
