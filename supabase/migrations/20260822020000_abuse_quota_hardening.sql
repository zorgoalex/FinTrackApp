BEGIN;

-- A user may have several legitimate browsers, but an unbounded number of
-- subscriptions turns every scheduled notification into attacker-controlled
-- fan-out. The advisory transaction lock makes the five-device cap safe under
-- concurrent registrations for the same user and workspace.
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
  v_existing_id uuid;
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

  PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || v_actor::text, 0));
  SELECT subscription.id INTO v_existing_id
  FROM public.push_subscriptions AS subscription
  WHERE subscription.workspace_id = p_workspace_id
    AND subscription.user_id = v_actor
    AND subscription.endpoint = p_endpoint;

  IF v_existing_id IS NULL AND (
    SELECT count(*) FROM public.push_subscriptions AS subscription
    WHERE subscription.workspace_id = p_workspace_id
      AND subscription.user_id = v_actor
  ) >= 5 THEN
    RAISE EXCEPTION 'Достигнут лимит Web Push устройств (5)';
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

COMMIT;
