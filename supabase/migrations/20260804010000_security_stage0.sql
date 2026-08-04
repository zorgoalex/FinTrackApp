BEGIN;

-- Small, atomic rate-limit buckets for Edge Functions. The table intentionally
-- stores opaque subjects (user UUIDs or hashes), never raw financial payloads.
CREATE TABLE IF NOT EXISTS public.security_rate_limits (
  bucket text NOT NULL,
  subject text NOT NULL,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (bucket, subject, window_started_at)
);

ALTER TABLE public.security_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.security_rate_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.security_rate_limits TO service_role;

CREATE INDEX IF NOT EXISTS security_rate_limits_expiry_idx
  ON public.security_rate_limits (expires_at);

CREATE OR REPLACE FUNCTION public.consume_security_rate_limit(
  p_bucket text,
  p_subject text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_window timestamptz;
  v_count integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Недостаточно прав';
  END IF;
  IF p_bucket !~ '^[a-z0-9:_-]{1,80}$'
     OR length(COALESCE(p_subject, '')) NOT BETWEEN 1 AND 160
     OR p_limit NOT BETWEEN 1 AND 10000
     OR p_window_seconds NOT BETWEEN 10 AND 86400 THEN
    RAISE EXCEPTION 'Некорректная конфигурация rate limit';
  END IF;

  v_window := to_timestamp(
    floor(extract(epoch FROM clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.security_rate_limits(bucket, subject, window_started_at, request_count, expires_at)
  VALUES (p_bucket, p_subject, v_window, 1, v_window + make_interval(secs => p_window_seconds * 2))
  ON CONFLICT (bucket, subject, window_started_at) DO UPDATE
    SET request_count = public.security_rate_limits.request_count + 1
  RETURNING request_count INTO v_count;

  IF random() < 0.01 THEN
    DELETE FROM public.security_rate_limits WHERE expires_at < clock_timestamp();
  END IF;

  RETURN v_count <= p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_security_rate_limit(text, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_security_rate_limit(text, text, integer, integer)
  TO service_role;

-- Telegram delivers the same update again when a webhook response is lost.
-- Claiming update_id makes all command handlers idempotent.
CREATE TABLE IF NOT EXISTS public.telegram_webhook_updates (
  update_id bigint PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.telegram_webhook_updates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.telegram_webhook_updates FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.telegram_webhook_updates TO service_role;

CREATE INDEX IF NOT EXISTS telegram_webhook_updates_received_idx
  ON public.telegram_webhook_updates (received_at);

CREATE OR REPLACE FUNCTION public.claim_telegram_webhook_update(p_update_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Недостаточно прав';
  END IF;
  IF p_update_id IS NULL OR p_update_id < 0 THEN
    RETURN false;
  END IF;

  DELETE FROM public.telegram_webhook_updates
  WHERE received_at < clock_timestamp() - interval '7 days';

  INSERT INTO public.telegram_webhook_updates(update_id)
  VALUES (p_update_id)
  ON CONFLICT DO NOTHING;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_telegram_webhook_update(bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_telegram_webhook_update(bigint) TO service_role;

-- A strict provider allowlist removes the arbitrary-host SSRF primitive. Keep
-- this list in sync with the Edge delivery validator.
CREATE OR REPLACE FUNCTION public.is_allowed_web_push_endpoint(p_endpoint text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
  SELECT p_endpoint ~ '^https://fcm\.googleapis\.com/(fcm/send|wp)/'
      OR p_endpoint ~ '^https://updates\.push\.services\.mozilla\.com/wpush/'
      OR p_endpoint ~ '^https://web\.push\.apple\.com/'
      OR p_endpoint ~ '^https://[a-z0-9-]+\.notify\.windows\.com/w/'
$$;

REVOKE ALL ON FUNCTION public.is_allowed_web_push_endpoint(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_allowed_web_push_endpoint(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.upsert_push_subscription(
  p_workspace_id uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Требуется авторизация'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members member
    WHERE member.workspace_id = p_workspace_id
      AND member.user_id = v_actor
      AND member.is_active
  ) THEN RAISE EXCEPTION 'Нет доступа к рабочему пространству'; END IF;
  IF length(COALESCE(p_endpoint, '')) NOT BETWEEN 20 AND 2048
     OR NOT public.is_allowed_web_push_endpoint(p_endpoint)
     OR length(COALESCE(p_p256dh, '')) NOT BETWEEN 20 AND 512
     OR length(COALESCE(p_auth, '')) NOT BETWEEN 8 AND 256 THEN
    RAISE EXCEPTION 'Некорректная Web Push подписка';
  END IF;

  INSERT INTO public.push_subscriptions(workspace_id, user_id, endpoint, p256dh, auth, user_agent)
  VALUES (p_workspace_id, v_actor, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 500))
  ON CONFLICT (workspace_id, user_id, endpoint) DO UPDATE SET
    p256dh = EXCLUDED.p256dh,
    auth = EXCLUDED.auth,
    user_agent = EXCLUDED.user_agent,
    last_seen_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_push_subscription(uuid, text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_push_subscription(uuid, text, text, text, text)
  TO authenticated;

-- Preserve the already tested deletion implementation behind a new wrapper.
-- The wrapper requires a newly created password-authenticated session.
ALTER FUNCTION public.delete_my_account(text) RENAME TO delete_my_account_internal;
REVOKE ALL ON FUNCTION public.delete_my_account_internal(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.delete_my_account(p_confirmation_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_claims jsonb := auth.jwt();
  v_session_id uuid;
  v_has_recent_password boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация';
  END IF;

  BEGIN
    v_session_id := NULLIF(v_claims ->> 'session_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_session_id := NULL;
  END;

  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(v_claims -> 'amr', '[]'::jsonb)) AS method
    WHERE method ->> 'method' = 'password'
      AND (method ->> 'timestamp') ~ '^[0-9]+$'
      AND (method ->> 'timestamp')::bigint >= extract(epoch FROM clock_timestamp() - interval '5 minutes')::bigint
  ) INTO v_has_recent_password;

  IF v_session_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM auth.sessions session
       WHERE session.id = v_session_id AND session.user_id = v_actor
     )
     OR NOT v_has_recent_password THEN
    RAISE EXCEPTION 'Повторно подтвердите текущий пароль';
  END IF;

  PERFORM public.delete_my_account_internal(p_confirmation_email);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_my_account(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account(text) TO authenticated;

COMMIT;
