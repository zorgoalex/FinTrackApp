BEGIN;

CREATE TABLE public.offline_operation_requests (
  client_request_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL REFERENCES public.operations(id) ON DELETE RESTRICT,
  payload_hash text NOT NULL CHECK (length(payload_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, client_request_id),
  UNIQUE (operation_id)
);

CREATE INDEX offline_operation_requests_workspace_idx
  ON public.offline_operation_requests(workspace_id, synced_at DESC);

ALTER TABLE public.offline_operation_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY offline_operation_requests_select ON public.offline_operation_requests FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.workspace_members member
      WHERE member.workspace_id = offline_operation_requests.workspace_id
        AND member.user_id = (SELECT auth.uid())
        AND member.is_active
    )
  );
GRANT SELECT ON public.offline_operation_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.create_offline_expense(
  p_client_request_id uuid,
  p_workspace_id uuid,
  p_amount numeric,
  p_type text,
  p_description text,
  p_operation_date date,
  p_category_id uuid,
  p_counterparty_id uuid,
  p_account_id uuid,
  p_currency text,
  p_exchange_rate numeric,
  p_base_amount numeric,
  p_debt_id uuid,
  p_debt_applied_amount numeric,
  p_allocations jsonb DEFAULT '[]'::jsonb,
  p_tag_names text[] DEFAULT '{}'::text[]
)
RETURNS public.operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_existing public.offline_operation_requests;
  v_operation public.operations;
  v_payload_hash text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Требуется авторизация'; END IF;
  IF p_client_request_id IS NULL THEN RAISE EXCEPTION 'Не указан идентификатор offline-запроса'; END IF;
  IF p_type NOT IN ('expense', 'employee_salary') THEN
    RAISE EXCEPTION 'Offline-синхронизация разрешена только для расходов';
  END IF;

  v_payload_hash := md5(jsonb_build_object(
    'workspace_id', p_workspace_id, 'amount', p_amount, 'type', p_type,
    'description', COALESCE(p_description, ''), 'operation_date', p_operation_date,
    'category_id', p_category_id, 'counterparty_id', p_counterparty_id,
    'account_id', p_account_id, 'currency', upper(p_currency),
    'exchange_rate', p_exchange_rate, 'base_amount', p_base_amount,
    'debt_id', p_debt_id, 'debt_applied_amount', p_debt_applied_amount,
    'allocations', COALESCE(p_allocations, '[]'::jsonb),
    'tag_names', COALESCE(to_jsonb(p_tag_names), '[]'::jsonb)
  )::text);

  PERFORM pg_advisory_xact_lock(hashtextextended(v_actor::text || ':' || p_client_request_id::text, 0));
  SELECT * INTO v_existing
  FROM public.offline_operation_requests request
  WHERE request.user_id = v_actor AND request.client_request_id = p_client_request_id;

  IF FOUND THEN
    IF v_existing.payload_hash <> v_payload_hash THEN
      RAISE EXCEPTION 'Идентификатор offline-запроса уже использован с другими данными';
    END IF;
    SELECT * INTO v_operation FROM public.operations WHERE id = v_existing.operation_id;
    RETURN v_operation;
  END IF;

  v_operation := public.create_operation_with_allocations(
    p_workspace_id, p_amount, p_type, p_description, p_operation_date,
    p_category_id, p_counterparty_id, p_account_id, p_currency,
    p_exchange_rate, p_base_amount, p_debt_id, p_debt_applied_amount,
    COALESCE(p_allocations, '[]'::jsonb), COALESCE(p_tag_names, '{}'::text[])
  );

  INSERT INTO public.offline_operation_requests(
    client_request_id, workspace_id, user_id, operation_id, payload_hash
  ) VALUES (
    p_client_request_id, p_workspace_id, v_actor, v_operation.id, v_payload_hash
  );
  RETURN v_operation;
END;
$$;

REVOKE ALL ON FUNCTION public.create_offline_expense(uuid, uuid, numeric, text, text, date, uuid, uuid, uuid, text, numeric, numeric, uuid, numeric, jsonb, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_offline_expense(uuid, uuid, numeric, text, text, date, uuid, uuid, uuid, text, numeric, numeric, uuid, numeric, jsonb, text[]) TO authenticated;

CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL CHECK (length(endpoint) BETWEEN 20 AND 4096),
  p256dh text NOT NULL CHECK (length(p256dh) BETWEEN 20 AND 512),
  auth text NOT NULL CHECK (length(auth) BETWEEN 8 AND 256),
  user_agent text CHECK (user_agent IS NULL OR length(user_agent) <= 500),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id, endpoint)
);

CREATE INDEX push_subscriptions_delivery_idx
  ON public.push_subscriptions(user_id, workspace_id, last_seen_at DESC);

CREATE TRIGGER update_push_subscriptions_updated_at
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY push_subscriptions_select ON public.push_subscriptions FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.workspace_members member
      WHERE member.workspace_id = push_subscriptions.workspace_id
        AND member.user_id = (SELECT auth.uid())
        AND member.is_active
    )
  );
GRANT SELECT ON public.push_subscriptions TO authenticated;

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
    WHERE member.workspace_id = p_workspace_id AND member.user_id = v_actor AND member.is_active
  ) THEN RAISE EXCEPTION 'Нет доступа к рабочему пространству'; END IF;
  IF length(COALESCE(p_endpoint, '')) NOT BETWEEN 20 AND 4096
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

CREATE OR REPLACE FUNCTION public.delete_push_subscription(p_workspace_id uuid, p_endpoint text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Требуется авторизация'; END IF;
  DELETE FROM public.push_subscriptions
  WHERE workspace_id = p_workspace_id AND user_id = v_actor AND endpoint = p_endpoint;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_push_subscription(uuid, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_push_subscription(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_push_subscription(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_push_subscription(uuid, text) TO authenticated;

ALTER TABLE public.app_notifications
  ADD COLUMN push_sent_at timestamptz,
  ADD COLUMN push_error text,
  ADD COLUMN email_sent_at timestamptz,
  ADD COLUMN email_error text;

COMMIT;
