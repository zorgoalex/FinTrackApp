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

  SELECT * INTO v_link
  FROM public.telegram_link_tokens
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

  DELETE FROM public.telegram_users
  WHERE telegram_id = p_telegram_id OR user_id = v_link.user_id;

  INSERT INTO public.telegram_users(
    telegram_id,
    chat_id,
    user_id,
    default_workspace_id,
    telegram_username,
    first_name,
    linked_at
  )
  VALUES (
    p_telegram_id,
    p_chat_id,
    v_link.user_id,
    v_workspace_id,
    NULLIF(btrim(p_telegram_username), ''),
    NULLIF(btrim(p_first_name), ''),
    now()
  );

  UPDATE public.telegram_link_tokens SET used_at = now() WHERE id = v_link.id;
  RETURN v_link.user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_telegram_link_token(text, bigint, bigint, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_telegram_link_token(text, bigint, bigint, text, text)
  TO service_role;
