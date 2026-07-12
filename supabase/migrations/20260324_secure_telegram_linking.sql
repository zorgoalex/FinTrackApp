BEGIN;

ALTER TABLE public.telegram_users
  ADD COLUMN IF NOT EXISTS chat_id bigint,
  ADD COLUMN IF NOT EXISTS telegram_username text,
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS linked_at timestamptz NOT NULL DEFAULT now();

UPDATE public.telegram_users SET chat_id = telegram_id WHERE chat_id IS NULL;
ALTER TABLE public.telegram_users ALTER COLUMN chat_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS telegram_users_user_id_unique ON public.telegram_users(user_id);

CREATE TABLE IF NOT EXISTS public.telegram_link_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS telegram_link_tokens_user_idx ON public.telegram_link_tokens(user_id, created_at DESC);
ALTER TABLE public.telegram_link_tokens ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.create_telegram_link_token()
RETURNS TABLE(token text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_token text;
  v_expires_at timestamptz := now() + interval '10 minutes';
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Требуется авторизация'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.telegram_link_tokens AS t
    WHERE t.user_id = v_user_id AND t.used_at IS NULL AND t.expires_at > now() AND t.created_at > now() - interval '30 seconds'
  ) THEN
    RAISE EXCEPTION 'Подождите 30 секунд перед созданием новой ссылки';
  END IF;

  UPDATE public.telegram_link_tokens AS t SET expires_at = now()
  WHERE t.user_id = v_user_id AND t.used_at IS NULL AND t.expires_at > now();
  DELETE FROM public.telegram_link_tokens AS t
  WHERE t.expires_at < now() - interval '1 day' OR t.used_at < now() - interval '1 day';

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  INSERT INTO public.telegram_link_tokens(user_id, token_hash, expires_at)
  VALUES (v_user_id, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_expires_at);
  RETURN QUERY SELECT v_token, v_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_telegram_link_token(
  p_token text,
  p_telegram_id bigint,
  p_chat_id bigint,
  p_telegram_username text DEFAULT NULL,
  p_first_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_link public.telegram_link_tokens%ROWTYPE;
  v_workspace_id uuid;
BEGIN
  IF p_token IS NULL OR length(p_token) <> 48 OR p_telegram_id IS NULL OR p_chat_id IS NULL THEN
    RAISE EXCEPTION 'Недействительная ссылка';
  END IF;
  SELECT * INTO v_link FROM public.telegram_link_tokens
  WHERE token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  FOR UPDATE;
  IF NOT FOUND OR v_link.used_at IS NOT NULL OR v_link.expires_at <= now() THEN
    RAISE EXCEPTION 'Ссылка недействительна или истекла';
  END IF;

  SELECT wm.workspace_id INTO v_workspace_id
  FROM public.workspace_members wm
  WHERE wm.user_id = v_link.user_id AND wm.is_active
  ORDER BY COALESCE(wm.last_accessed_at, wm.joined_at, wm.invited_at) DESC
  LIMIT 1;

  DELETE FROM public.telegram_users WHERE telegram_id = p_telegram_id OR user_id = v_link.user_id;
  INSERT INTO public.telegram_users(telegram_id, chat_id, user_id, default_workspace_id, telegram_username, first_name, linked_at)
  VALUES (p_telegram_id, p_chat_id, v_link.user_id, v_workspace_id, NULLIF(btrim(p_telegram_username), ''), NULLIF(btrim(p_first_name), ''), now());
  UPDATE public.telegram_link_tokens SET used_at = now() WHERE id = v_link.id;
  RETURN v_link.user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_telegram_link_status()
RETURNS TABLE(linked boolean, telegram_username text, first_name text, linked_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT true, tu.telegram_username, tu.first_name, tu.linked_at
  FROM public.telegram_users tu WHERE tu.user_id = (SELECT auth.uid())
  UNION ALL
  SELECT false, NULL::text, NULL::text, NULL::timestamptz
  WHERE NOT EXISTS (SELECT 1 FROM public.telegram_users tu WHERE tu.user_id = (SELECT auth.uid()))
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.unlink_my_telegram_account()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.telegram_users WHERE user_id = (SELECT auth.uid());
  DELETE FROM public.telegram_link_tokens WHERE user_id = (SELECT auth.uid()) AND used_at IS NULL;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON TABLE public.telegram_link_tokens FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_telegram_link_token() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consume_telegram_link_token(text, bigint, bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_telegram_link_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unlink_my_telegram_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_telegram_link_token() TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_telegram_link_token(text, bigint, bigint, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_my_telegram_link_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlink_my_telegram_account() TO authenticated;

COMMIT;
