-- Secure, user-scoped personal-data export authorization and audit projection.
-- Export payloads are assembled by the Edge Function through the caller's JWT,
-- so existing RLS remains authoritative for every exported public row.

BEGIN;

CREATE OR REPLACE FUNCTION public.authorize_my_privacy_export()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Недостаточно прав';
  END IF;

  IF NOT public.current_session_has_fresh_password() THEN
    RAISE EXCEPTION 'Повторно подтвердите текущий пароль';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.authorize_my_privacy_export()
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.authorize_my_privacy_export()
  TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_privacy_security_events()
RETURNS TABLE(
  occurred_at timestamptz,
  event_type text,
  outcome text,
  workspace_id uuid,
  relation text,
  source text,
  metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, auth, pg_catalog
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Недостаточно прав';
  END IF;

  IF NOT public.current_session_has_fresh_password() THEN
    RAISE EXCEPTION 'Повторно подтвердите текущий пароль';
  END IF;

  RETURN QUERY
  SELECT
    event.occurred_at,
    event.event_type,
    event.outcome,
    event.workspace_id,
    CASE
      WHEN event.actor_user_id = auth.uid() AND event.target_user_id = auth.uid() THEN 'actor_and_target'
      WHEN event.actor_user_id = auth.uid() THEN 'actor'
      ELSE 'target'
    END::text AS relation,
    event.source,
    event.metadata
  FROM private.security_events AS event
  WHERE event.actor_user_id = auth.uid()
     OR event.target_user_id = auth.uid()
  ORDER BY event.occurred_at DESC, event.id DESC
  LIMIT 1000;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_privacy_security_events()
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_privacy_security_events()
  TO authenticated;

COMMENT ON FUNCTION public.authorize_my_privacy_export() IS
  'Requires a live authenticated session with a password sign-in in the last five minutes.';
COMMENT ON FUNCTION public.get_my_privacy_security_events() IS
  'Returns a bounded, redacted projection of security events involving the current user.';

COMMIT;
