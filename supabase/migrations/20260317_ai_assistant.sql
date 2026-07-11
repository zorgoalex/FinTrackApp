-- Read-only AI assistant: role policy, bounded semantic context and audit log.

CREATE TABLE IF NOT EXISTS public.ai_access_policies (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (lower(role) IN ('owner', 'admin', 'member', 'viewer')),
  enabled boolean NOT NULL DEFAULT false,
  data_scope text NOT NULL DEFAULT 'aggregate'
    CHECK (data_scope IN ('aggregate', 'own_detail', 'workspace_detail')),
  include_accounts boolean NOT NULL DEFAULT true,
  include_categories boolean NOT NULL DEFAULT true,
  include_descriptions boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (workspace_id, role)
);

CREATE TABLE IF NOT EXISTS public.ai_assistant_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question text NOT NULL CHECK (char_length(question) BETWEEN 1 AND 1000),
  model text,
  status text NOT NULL CHECK (status IN ('success', 'mock', 'error')),
  prompt_tokens integer,
  completion_tokens integer,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_assistant_logs_workspace_created_idx
  ON public.ai_assistant_logs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_assistant_logs_user_created_idx
  ON public.ai_assistant_logs(user_id, created_at DESC);

ALTER TABLE public.ai_access_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_assistant_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_access_policies_select ON public.ai_access_policies;
CREATE POLICY ai_access_policies_select ON public.ai_access_policies FOR SELECT
  USING (public.is_workspace_member(auth.uid(), workspace_id));
DROP POLICY IF EXISTS ai_access_policies_manage ON public.ai_access_policies;
CREATE POLICY ai_access_policies_manage ON public.ai_access_policies FOR ALL
  USING (public.user_has_role(auth.uid(), workspace_id, ARRAY['Owner', 'Admin']))
  WITH CHECK (public.user_has_role(auth.uid(), workspace_id, ARRAY['Owner', 'Admin']));

DROP POLICY IF EXISTS ai_assistant_logs_insert ON public.ai_assistant_logs;
CREATE POLICY ai_assistant_logs_insert ON public.ai_assistant_logs FOR INSERT
  WITH CHECK (user_id = auth.uid() AND public.is_workspace_member(auth.uid(), workspace_id));
DROP POLICY IF EXISTS ai_assistant_logs_select ON public.ai_assistant_logs;
CREATE POLICY ai_assistant_logs_select ON public.ai_assistant_logs FOR SELECT
  USING (user_id = auth.uid() OR public.user_has_role(auth.uid(), workspace_id, ARRAY['Owner', 'Admin']));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_access_policies TO authenticated, service_role;
GRANT SELECT, INSERT ON public.ai_assistant_logs TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.seed_ai_access_policies(p_workspace_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.ai_access_policies
    (workspace_id, role, enabled, data_scope, include_accounts, include_categories, include_descriptions)
  VALUES
    (p_workspace_id, 'owner', true, 'workspace_detail', true, true, true),
    (p_workspace_id, 'admin', true, 'workspace_detail', true, true, true),
    (p_workspace_id, 'member', true, 'own_detail', true, true, false),
    (p_workspace_id, 'viewer', false, 'aggregate', false, true, false)
  ON CONFLICT (workspace_id, role) DO NOTHING;
$$;

SELECT public.seed_ai_access_policies(id) FROM public.workspaces;

CREATE OR REPLACE FUNCTION public.seed_ai_access_policies_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_ai_access_policies(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workspaces_seed_ai_access_policies ON public.workspaces;
CREATE TRIGGER workspaces_seed_ai_access_policies
AFTER INSERT ON public.workspaces
FOR EACH ROW EXECUTE FUNCTION public.seed_ai_access_policies_trigger();

CREATE OR REPLACE FUNCTION public.get_ai_financial_context(
  p_workspace_id uuid,
  p_date_from date,
  p_date_to date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
  v_policy public.ai_access_policies%ROWTYPE;
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Требуется авторизация'; END IF;
  IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_from > p_date_to THEN
    RAISE EXCEPTION 'Некорректный период';
  END IF;
  IF p_date_to - p_date_from > 366 THEN RAISE EXCEPTION 'Период не может превышать 366 дней'; END IF;

  SELECT lower(wm.role::text) INTO v_role
  FROM public.workspace_members wm
  WHERE wm.workspace_id = p_workspace_id AND wm.user_id = v_user_id AND wm.is_active;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Нет доступа к пространству'; END IF;

  SELECT * INTO v_policy FROM public.ai_access_policies
  WHERE workspace_id = p_workspace_id AND role = v_role;
  IF NOT FOUND OR NOT v_policy.enabled THEN RAISE EXCEPTION 'AI-ассистент недоступен для вашей роли'; END IF;

  SELECT jsonb_build_object(
    'period', jsonb_build_object('from', p_date_from, 'to', p_date_to),
    'role', v_role,
    'scope', v_policy.data_scope,
    'base_currency', w.base_currency,
    'summary', jsonb_build_object(
      'income', COALESCE(sum(CASE WHEN o.type = 'income' THEN o.base_amount ELSE 0 END), 0),
      'expense', COALESCE(sum(CASE WHEN o.type IN ('expense', 'salary') THEN o.base_amount ELSE 0 END), 0),
      'net', COALESCE(sum(CASE WHEN o.type = 'income' THEN o.base_amount WHEN o.type IN ('expense', 'salary') THEN -o.base_amount ELSE 0 END), 0),
      'operation_count', count(o.id) FILTER (WHERE NOT (o.type = 'transfer' AND o.transfer_direction = 'in'))
    )
  ) INTO v_result
  FROM public.workspaces w
  LEFT JOIN public.operations o ON o.workspace_id = w.id
    AND o.operation_date BETWEEN p_date_from AND p_date_to
    AND (v_policy.data_scope <> 'own_detail' OR o.user_id = v_user_id)
  WHERE w.id = p_workspace_id
  GROUP BY w.id, w.base_currency;

  IF v_policy.include_categories THEN
    v_result := v_result || jsonb_build_object('categories', COALESCE((
      SELECT jsonb_agg(row_data ORDER BY (row_data->>'amount')::numeric DESC)
      FROM (
        SELECT jsonb_build_object('name', c.name, 'type', o.type, 'amount', round(sum(o.base_amount), 2), 'count', count(*)) AS row_data
        FROM public.operations o JOIN public.categories c ON c.id = o.category_id
        WHERE o.workspace_id = p_workspace_id AND o.operation_date BETWEEN p_date_from AND p_date_to
          AND o.type IN ('income', 'expense', 'salary')
          AND (v_policy.data_scope <> 'own_detail' OR o.user_id = v_user_id)
        GROUP BY c.name, o.type ORDER BY sum(o.base_amount) DESC LIMIT 30
      ) category_rows
    ), '[]'::jsonb));
  END IF;

  IF v_policy.include_accounts THEN
    v_result := v_result || jsonb_build_object('accounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', a.name, 'currency', a.currency, 'balance', COALESCE(b.balance, 0)) ORDER BY a.name)
      FROM public.accounts a
      LEFT JOIN LATERAL (
        SELECT round(sum(CASE
          WHEN o.type = 'income' OR (o.type = 'transfer' AND o.transfer_direction = 'in') THEN o.amount
          WHEN o.type IN ('expense', 'salary') OR (o.type = 'transfer' AND o.transfer_direction = 'out') THEN -o.amount
          ELSE 0 END), 2) AS balance
        FROM public.operations o WHERE o.account_id = a.id
          AND (v_policy.data_scope <> 'own_detail' OR o.user_id = v_user_id)
      ) b ON true
      WHERE a.workspace_id = p_workspace_id AND NOT a.is_archived
    ), '[]'::jsonb));
  END IF;

  IF v_policy.data_scope IN ('own_detail', 'workspace_detail') THEN
    v_result := v_result || jsonb_build_object('recent_operations', COALESCE((
      SELECT jsonb_agg(row_data ORDER BY row_data->>'date' DESC)
      FROM (
        SELECT jsonb_build_object(
          'date', o.operation_date, 'type', o.type, 'amount', o.base_amount,
          'category', c.name,
          'description', CASE WHEN v_policy.include_descriptions THEN left(o.description, 160) ELSE NULL END
        ) AS row_data
        FROM public.operations o LEFT JOIN public.categories c ON c.id = o.category_id
        WHERE o.workspace_id = p_workspace_id AND o.operation_date BETWEEN p_date_from AND p_date_to
          AND NOT (o.type = 'transfer' AND o.transfer_direction = 'in')
          AND (v_policy.data_scope <> 'own_detail' OR o.user_id = v_user_id)
        ORDER BY o.operation_date DESC, o.created_at DESC LIMIT 50
      ) recent_rows
    ), '[]'::jsonb));
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_ai_access_policies(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seed_ai_access_policies_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_ai_financial_context(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ai_financial_context(uuid, date, date) TO authenticated, service_role;
