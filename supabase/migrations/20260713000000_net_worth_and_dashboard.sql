-- P2 product completion: assets/liabilities, net-worth reporting and
-- per-user server-synchronised dashboard preferences.

BEGIN;

CREATE TABLE public.net_worth_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('asset', 'liability')),
  category text NOT NULL CHECK (category IN (
    'real_estate', 'vehicle', 'investment', 'equipment', 'receivable', 'other_asset',
    'mortgage', 'loan', 'credit_card', 'tax', 'payable', 'other_liability'
  )),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  description text,
  currency text NOT NULL REFERENCES public.currencies(code),
  current_value numeric(15,2) NOT NULL CHECK (current_value >= 0),
  exchange_rate numeric(20,10) NOT NULL CHECK (exchange_rate > 0),
  current_base_value numeric(15,2) NOT NULL CHECK (current_base_value >= 0),
  valued_on date NOT NULL DEFAULT CURRENT_DATE,
  is_archived boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id)
);

CREATE INDEX net_worth_items_workspace_kind_idx
  ON public.net_worth_items(workspace_id, kind, is_archived);

CREATE TABLE public.net_worth_valuations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  value numeric(15,2) NOT NULL CHECK (value >= 0),
  exchange_rate numeric(20,10) NOT NULL CHECK (exchange_rate > 0),
  base_value numeric(15,2) NOT NULL CHECK (base_value >= 0),
  valued_on date NOT NULL,
  note text,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT net_worth_valuations_item_workspace_fkey
    FOREIGN KEY (item_id, workspace_id)
    REFERENCES public.net_worth_items(id, workspace_id) ON DELETE CASCADE,
  UNIQUE (item_id, valued_on)
);

CREATE INDEX net_worth_valuations_item_date_idx
  ON public.net_worth_valuations(item_id, valued_on DESC);

CREATE TABLE public.net_worth_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  target_amount numeric(15,2) NOT NULL CHECK (target_amount > 0),
  target_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id)
);

CREATE UNIQUE INDEX net_worth_goals_one_active_idx
  ON public.net_worth_goals(workspace_id) WHERE status = 'active';

CREATE TABLE public.dashboard_preferences (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  widget_order text[] NOT NULL DEFAULT ARRAY['summary','accounts','net_worth','debts','recent_operations'],
  hidden_widgets text[] NOT NULL DEFAULT ARRAY[]::text[],
  widget_sizes jsonb NOT NULL DEFAULT '{}'::jsonb,
  widget_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id),
  CHECK (widget_order <@ ARRAY['summary','accounts','net_worth','debts','recent_operations']::text[]),
  CHECK (hidden_widgets <@ ARRAY['summary','accounts','net_worth','debts','recent_operations']::text[]),
  CHECK (jsonb_typeof(widget_sizes) = 'object'),
  CHECK (jsonb_typeof(widget_settings) = 'object')
);

CREATE OR REPLACE FUNCTION public.prepare_net_worth_item()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_base_currency text;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.workspace_id, NEW.created_by) IS DISTINCT FROM (OLD.workspace_id, OLD.created_by) THEN
    RAISE EXCEPTION 'Рабочее пространство и автор объекта неизменяемы';
  END IF;
  NEW.name := btrim(NEW.name);
  NEW.description := NULLIF(btrim(NEW.description), '');
  NEW.currency := upper(NEW.currency);
  SELECT base_currency INTO v_base_currency FROM public.workspaces WHERE id = NEW.workspace_id;
  IF NEW.currency = v_base_currency THEN
    NEW.exchange_rate := 1;
  END IF;
  IF abs(NEW.current_base_value - round(NEW.current_value * NEW.exchange_rate, 2)) > 0.01 THEN
    RAISE EXCEPTION 'Стоимость в базовой валюте не соответствует сумме и курсу';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_net_worth_valuation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR (OLD.current_value, OLD.exchange_rate, OLD.current_base_value, OLD.valued_on)
        IS DISTINCT FROM
        (NEW.current_value, NEW.exchange_rate, NEW.current_base_value, NEW.valued_on) THEN
    INSERT INTO public.net_worth_valuations (
      workspace_id, item_id, value, exchange_rate, base_value, valued_on, created_by
    ) VALUES (
      NEW.workspace_id, NEW.id, NEW.current_value, NEW.exchange_rate,
      NEW.current_base_value, NEW.valued_on, COALESCE(auth.uid(), NEW.created_by)
    )
    ON CONFLICT (item_id, valued_on) DO UPDATE SET
      value = EXCLUDED.value,
      exchange_rate = EXCLUDED.exchange_rate,
      base_value = EXCLUDED.base_value,
      created_by = EXCLUDED.created_by,
      created_at = now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prepare_net_worth_item_before_write
  BEFORE INSERT OR UPDATE ON public.net_worth_items
  FOR EACH ROW EXECUTE FUNCTION public.prepare_net_worth_item();
CREATE TRIGGER record_net_worth_valuation_after_write
  AFTER INSERT OR UPDATE ON public.net_worth_items
  FOR EACH ROW EXECUTE FUNCTION public.record_net_worth_valuation();
CREATE TRIGGER update_net_worth_items_updated_at
  BEFORE UPDATE ON public.net_worth_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_net_worth_goals_updated_at
  BEFORE UPDATE ON public.net_worth_goals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_dashboard_preferences_updated_at
  BEFORE UPDATE ON public.dashboard_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.net_worth_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.net_worth_valuations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.net_worth_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY net_worth_items_select ON public.net_worth_items FOR SELECT
  USING (public.is_workspace_member((SELECT auth.uid()), workspace_id));
CREATE POLICY net_worth_items_insert ON public.net_worth_items FOR INSERT
  WITH CHECK (created_by = (SELECT auth.uid())
    AND public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner','Admin']));
CREATE POLICY net_worth_items_update ON public.net_worth_items FOR UPDATE
  USING (public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner','Admin']))
  WITH CHECK (public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner','Admin']));
CREATE POLICY net_worth_items_delete ON public.net_worth_items FOR DELETE
  USING (public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner','Admin']));

CREATE POLICY net_worth_valuations_select ON public.net_worth_valuations FOR SELECT
  USING (public.is_workspace_member((SELECT auth.uid()), workspace_id));

CREATE POLICY net_worth_goals_select ON public.net_worth_goals FOR SELECT
  USING (public.is_workspace_member((SELECT auth.uid()), workspace_id));
CREATE POLICY net_worth_goals_insert ON public.net_worth_goals FOR INSERT
  WITH CHECK (created_by = (SELECT auth.uid())
    AND public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner','Admin']));
CREATE POLICY net_worth_goals_update ON public.net_worth_goals FOR UPDATE
  USING (public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner','Admin']))
  WITH CHECK (public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner','Admin']));
CREATE POLICY net_worth_goals_delete ON public.net_worth_goals FOR DELETE
  USING (public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner','Admin']));

CREATE POLICY dashboard_preferences_select ON public.dashboard_preferences FOR SELECT
  USING (user_id = (SELECT auth.uid())
    AND public.is_workspace_member((SELECT auth.uid()), workspace_id));
CREATE POLICY dashboard_preferences_insert ON public.dashboard_preferences FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid())
    AND public.is_workspace_member((SELECT auth.uid()), workspace_id));
CREATE POLICY dashboard_preferences_update ON public.dashboard_preferences FOR UPDATE
  USING (user_id = (SELECT auth.uid())
    AND public.is_workspace_member((SELECT auth.uid()), workspace_id))
  WITH CHECK (user_id = (SELECT auth.uid())
    AND public.is_workspace_member((SELECT auth.uid()), workspace_id));
CREATE POLICY dashboard_preferences_delete ON public.dashboard_preferences FOR DELETE
  USING (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.get_net_worth_report(
  p_workspace_id uuid,
  p_as_of date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  as_of date, base_currency text, cash numeric, manual_assets numeric,
  receivables numeric, total_assets numeric, manual_liabilities numeric,
  payables numeric, total_liabilities numeric, net_worth numeric
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_workspace_id IS NULL OR p_as_of IS NULL THEN RAISE EXCEPTION 'Рабочее пространство и дата обязательны'; END IF;
  IF auth.uid() IS NULL OR NOT public.is_workspace_member(auth.uid(), p_workspace_id) THEN
    RAISE EXCEPTION 'Нет доступа к рабочему пространству';
  END IF;

  RETURN QUERY
  WITH workspace_data AS (
    SELECT workspace.base_currency FROM public.workspaces workspace WHERE workspace.id = p_workspace_id
  ),
  cash_data AS (
    SELECT COALESCE(sum(
      CASE WHEN history.currency = history.base_currency THEN history.closing_balance
        ELSE history.closing_balance * public.get_exchange_rate(
          p_workspace_id, history.currency, history.base_currency, p_as_of
        )
      END
    ), 0)::numeric AS amount
    FROM public.get_account_balance_history(p_workspace_id, p_as_of, p_as_of, 'day', NULL) history
  ),
  latest_item_values AS (
    SELECT DISTINCT ON (item.id) item.id, item.kind, valuation.base_value
    FROM public.net_worth_items item
    JOIN public.net_worth_valuations valuation
      ON valuation.item_id = item.id AND valuation.workspace_id = item.workspace_id
    WHERE item.workspace_id = p_workspace_id AND NOT item.is_archived AND valuation.valued_on <= p_as_of
    ORDER BY item.id, valuation.valued_on DESC, valuation.created_at DESC
  ),
  item_totals AS (
    SELECT
      COALESCE(sum(base_value) FILTER (WHERE kind = 'asset'), 0)::numeric AS assets,
      COALESCE(sum(base_value) FILTER (WHERE kind = 'liability'), 0)::numeric AS liabilities
    FROM latest_item_values
  ),
  debt_totals AS (
    SELECT
      COALESCE(sum(greatest(debt.initial_amount - COALESCE(payment.paid, 0), 0) *
        CASE WHEN debt.currency = workspace_data.base_currency THEN 1 ELSE
          public.get_exchange_rate(p_workspace_id, debt.currency, workspace_data.base_currency, p_as_of) END
      ) FILTER (WHERE debt.direction = 'owed_to_me'), 0)::numeric AS receivables,
      COALESCE(sum(greatest(debt.initial_amount - COALESCE(payment.paid, 0), 0) *
        CASE WHEN debt.currency = workspace_data.base_currency THEN 1 ELSE
          public.get_exchange_rate(p_workspace_id, debt.currency, workspace_data.base_currency, p_as_of) END
      ) FILTER (WHERE debt.direction = 'i_owe'), 0)::numeric AS payables
    FROM public.debts debt
    CROSS JOIN workspace_data
    LEFT JOIN LATERAL (
      SELECT sum(operation.amount)::numeric AS paid
      FROM public.operations operation
      WHERE operation.debt_id = debt.id AND operation.operation_date <= p_as_of
    ) payment ON true
    WHERE debt.workspace_id = p_workspace_id AND debt.opened_on <= p_as_of AND NOT debt.is_archived
  )
  SELECT p_as_of, workspace_data.base_currency, cash_data.amount,
    item_totals.assets, debt_totals.receivables,
    cash_data.amount + item_totals.assets + debt_totals.receivables,
    item_totals.liabilities, debt_totals.payables,
    item_totals.liabilities + debt_totals.payables,
    cash_data.amount + item_totals.assets + debt_totals.receivables
      - item_totals.liabilities - debt_totals.payables
  FROM workspace_data CROSS JOIN cash_data CROSS JOIN item_totals CROSS JOIN debt_totals;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_net_worth_history(
  p_workspace_id uuid, p_date_from date, p_date_to date, p_granularity text DEFAULT 'month'
)
RETURNS TABLE (period_start date, net_worth numeric, total_assets numeric, total_liabilities numeric)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_step interval; v_date date;
BEGIN
  IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_from > p_date_to THEN RAISE EXCEPTION 'Некорректный диапазон дат'; END IF;
  IF p_granularity NOT IN ('day','week','month') THEN RAISE EXCEPTION 'Допустимая детализация: day, week или month'; END IF;
  IF p_date_to - p_date_from > 1827 THEN RAISE EXCEPTION 'Диапазон истории не может превышать 5 лет'; END IF;
  v_step := CASE p_granularity WHEN 'day' THEN interval '1 day' WHEN 'week' THEN interval '1 week' ELSE interval '1 month' END;
  FOR v_date IN SELECT series::date FROM generate_series(p_date_from::timestamp, p_date_to::timestamp, v_step) series LOOP
    RETURN QUERY SELECT v_date, report.net_worth, report.total_assets, report.total_liabilities
      FROM public.get_net_worth_report(p_workspace_id, v_date) report;
  END LOOP;
END;
$$;

REVOKE ALL ON public.net_worth_items, public.net_worth_valuations, public.net_worth_goals, public.dashboard_preferences FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.net_worth_items, public.net_worth_goals, public.dashboard_preferences TO authenticated;
GRANT SELECT ON public.net_worth_valuations TO authenticated;
GRANT ALL ON public.net_worth_items, public.net_worth_valuations, public.net_worth_goals, public.dashboard_preferences TO service_role;

REVOKE ALL ON FUNCTION public.prepare_net_worth_item() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_net_worth_valuation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_net_worth_report(uuid,date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_net_worth_history(uuid,date,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_net_worth_report(uuid,date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_net_worth_history(uuid,date,date,text) TO authenticated, service_role;

COMMIT;
