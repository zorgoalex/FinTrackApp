-- P1 budget rollover/carryover and workspace-safe savings goals.

BEGIN;

ALTER TABLE public.budgets
  ADD COLUMN rollover_mode text NOT NULL DEFAULT 'none'
    CONSTRAINT budgets_rollover_mode_check CHECK (rollover_mode IN ('none', 'unused', 'full')),
  ADD COLUMN carry_cap numeric(15,2)
    CONSTRAINT budgets_carry_cap_check CHECK (carry_cap IS NULL OR carry_cap >= 0),
  ADD COLUMN carryover_amount numeric(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN source_budget_id uuid REFERENCES public.budgets(id) ON DELETE SET NULL;

-- Existing budgets deliberately retain their old behavior. No historical
-- carryover is inferred during deployment.
UPDATE public.budgets
SET rollover_mode = 'none', carryover_amount = 0, source_budget_id = NULL;

CREATE INDEX budgets_source_budget_idx ON public.budgets(source_budget_id)
  WHERE source_budget_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_budget_category_spent_internal(
  p_workspace_id uuid,
  p_category_id uuid,
  p_month date
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH operation_spend AS (
    SELECT operation.workspace_id, allocation.category_id,
      operation.operation_date, allocation.base_amount
    FROM public.operations operation
    JOIN public.operation_allocations allocation
      ON allocation.operation_id = operation.id
     AND allocation.workspace_id = operation.workspace_id
    WHERE operation.type IN ('expense', 'employee_salary')
    UNION ALL
    SELECT operation.workspace_id, operation.category_id,
      operation.operation_date, operation.base_amount
    FROM public.operations operation
    WHERE operation.type IN ('expense', 'employee_salary')
      AND operation.category_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.operation_allocations allocation
        WHERE allocation.operation_id = operation.id
      )
  )
  SELECT COALESCE(sum(spend.base_amount), 0)::numeric
  FROM operation_spend spend
  WHERE spend.workspace_id = p_workspace_id
    AND spend.category_id = p_category_id
    AND spend.operation_date >= date_trunc('month', p_month)::date
    AND spend.operation_date < (date_trunc('month', p_month) + interval '1 month')::date;
$$;

CREATE OR REPLACE FUNCTION public.ensure_budget_period(
  p_workspace_id uuid,
  p_category_id uuid,
  p_month date,
  p_amount numeric DEFAULT NULL,
  p_rollover_mode text DEFAULT NULL,
  p_carry_cap numeric DEFAULT NULL
)
RETURNS public.budgets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_month date := date_trunc('month', p_month)::date;
  v_previous public.budgets;
  v_result public.budgets;
  v_previous_remaining numeric := 0;
  v_carryover numeric := 0;
  v_amount numeric;
  v_mode text;
  v_cap numeric;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Требуется авторизация'; END IF;
  IF NOT public.user_has_role(v_actor, p_workspace_id, ARRAY['Owner', 'Admin']) THEN
    RAISE EXCEPTION 'Недостаточно прав для управления бюджетами';
  END IF;
  IF p_month IS NULL OR p_category_id IS NULL THEN
    RAISE EXCEPTION 'Категория и месяц обязательны';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.categories category
    WHERE category.id = p_category_id
      AND category.workspace_id = p_workspace_id
      AND category.type = 'expense'
      AND NOT category.is_archived
  ) THEN RAISE EXCEPTION 'Категория расходов не найдена или архивирована'; END IF;

  -- A transaction-scoped lock makes concurrent first creation deterministic.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || p_category_id::text || ':' || v_month::text, 0));
  SELECT * INTO v_result FROM public.budgets
  WHERE workspace_id = p_workspace_id AND category_id = p_category_id AND month = v_month;
  IF FOUND THEN RETURN v_result; END IF;

  SELECT * INTO v_previous FROM public.budgets
  WHERE workspace_id = p_workspace_id
    AND category_id = p_category_id
    AND month = (v_month - interval '1 month')::date;

  v_amount := COALESCE(p_amount, v_previous.amount);
  v_mode := COALESCE(p_rollover_mode, v_previous.rollover_mode, 'none');
  v_cap := CASE WHEN p_carry_cap IS NOT NULL THEN p_carry_cap ELSE v_previous.carry_cap END;
  IF v_amount IS NULL OR v_amount <= 0 OR v_amount <> round(v_amount, 2) THEN
    RAISE EXCEPTION 'Для первого периода требуется положительная сумма с точностью до 2 знаков';
  END IF;
  IF v_mode NOT IN ('none', 'unused', 'full') THEN RAISE EXCEPTION 'Некорректный режим переноса'; END IF;
  IF v_cap IS NOT NULL AND (v_cap < 0 OR v_cap <> round(v_cap, 2)) THEN
    RAISE EXCEPTION 'Лимит переноса должен быть неотрицательным и округлён до 2 знаков';
  END IF;

  IF v_previous.id IS NOT NULL AND v_mode <> 'none' THEN
    v_previous_remaining := v_previous.amount + v_previous.carryover_amount
      - public.get_budget_category_spent_internal(p_workspace_id, p_category_id, v_previous.month);
    v_carryover := CASE WHEN v_mode = 'unused' THEN greatest(v_previous_remaining, 0)
                        ELSE v_previous_remaining END;
    -- A cap limits only positive carry. Full mode may intentionally carry debt.
    IF v_cap IS NOT NULL AND v_carryover > v_cap THEN v_carryover := v_cap; END IF;
  END IF;

  INSERT INTO public.budgets (
    workspace_id, category_id, month, amount, created_by,
    rollover_mode, carry_cap, carryover_amount, source_budget_id
  ) VALUES (
    p_workspace_id, p_category_id, v_month, v_amount, v_actor,
    v_mode, v_cap, round(v_carryover, 2), v_previous.id
  ) RETURNING * INTO v_result;
  RETURN v_result;
END;
$$;

DROP FUNCTION public.get_budget_progress(uuid, date);
CREATE FUNCTION public.get_budget_progress(p_workspace_id uuid, p_month date)
RETURNS TABLE (
  id uuid, category_id uuid, amount numeric, rollover_mode text,
  carry_cap numeric, carryover_amount numeric, effective_amount numeric,
  spent numeric, remaining numeric, progress_pct numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_workspace_member(auth.uid(), p_workspace_id) THEN
    RAISE EXCEPTION 'Недостаточно прав для просмотра бюджетов';
  END IF;
  RETURN QUERY
  SELECT budget.id, budget.category_id, budget.amount, budget.rollover_mode,
    budget.carry_cap, budget.carryover_amount,
    (budget.amount + budget.carryover_amount)::numeric AS effective_amount,
    public.get_budget_category_spent_internal(budget.workspace_id, budget.category_id, budget.month) AS spent,
    (budget.amount + budget.carryover_amount
      - public.get_budget_category_spent_internal(budget.workspace_id, budget.category_id, budget.month))::numeric AS remaining,
    CASE WHEN budget.amount + budget.carryover_amount > 0 THEN
      round(public.get_budget_category_spent_internal(budget.workspace_id, budget.category_id, budget.month)
        / (budget.amount + budget.carryover_amount) * 100, 2)::numeric
      ELSE NULL::numeric END AS progress_pct
  FROM public.budgets budget
  WHERE budget.workspace_id = p_workspace_id
    AND budget.month = date_trunc('month', p_month)::date
  ORDER BY 10 DESC NULLS LAST, 7 DESC;
END;
$$;

CREATE TABLE public.savings_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CONSTRAINT savings_goals_name_not_empty CHECK (btrim(name) <> ''),
  target_amount numeric(15,2) NOT NULL CHECK (target_amount > 0),
  target_date date,
  account_id uuid,
  status text NOT NULL DEFAULT 'active'
    CONSTRAINT savings_goals_status_check CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT savings_goals_id_workspace_unique UNIQUE (id, workspace_id),
  CONSTRAINT savings_goals_account_workspace_fkey FOREIGN KEY (account_id, workspace_id)
    REFERENCES public.accounts(id, workspace_id) ON DELETE RESTRICT
);

CREATE INDEX savings_goals_workspace_status_idx ON public.savings_goals(workspace_id, status);
CREATE OR REPLACE FUNCTION public.prepare_savings_goal_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.name := btrim(NEW.name);
  NEW.completed_at := CASE
    WHEN NEW.status = 'completed' THEN COALESCE(NEW.completed_at, now())
    ELSE NULL
  END;
  RETURN NEW;
END;
$$;
CREATE TRIGGER prepare_savings_goal_status BEFORE INSERT OR UPDATE ON public.savings_goals
  FOR EACH ROW EXECUTE FUNCTION public.prepare_savings_goal_status();
CREATE TRIGGER update_savings_goals_updated_at BEFORE UPDATE ON public.savings_goals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.savings_goal_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  contribution_date date NOT NULL DEFAULT CURRENT_DATE,
  account_id uuid,
  operation_id uuid,
  note text,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT savings_goal_contributions_goal_workspace_fkey FOREIGN KEY (goal_id, workspace_id)
    REFERENCES public.savings_goals(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT savings_goal_contributions_account_workspace_fkey FOREIGN KEY (account_id, workspace_id)
    REFERENCES public.accounts(id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT savings_goal_contributions_operation_workspace_fkey FOREIGN KEY (operation_id, workspace_id)
    REFERENCES public.operations(id, workspace_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX savings_goal_contributions_goal_operation_key
  ON public.savings_goal_contributions(goal_id, operation_id) WHERE operation_id IS NOT NULL;
CREATE INDEX savings_goal_contributions_goal_date_idx
  ON public.savings_goal_contributions(goal_id, contribution_date DESC);
CREATE TRIGGER update_savings_goal_contributions_updated_at
  BEFORE UPDATE ON public.savings_goal_contributions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.savings_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.savings_goal_contributions ENABLE ROW LEVEL SECURITY;

CREATE POLICY savings_goals_select ON public.savings_goals FOR SELECT
  USING (public.is_workspace_member((SELECT auth.uid()), workspace_id));
CREATE POLICY savings_goals_insert ON public.savings_goals FOR INSERT
  WITH CHECK (created_by = (SELECT auth.uid()) AND public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner','Admin']));
CREATE POLICY savings_goals_update ON public.savings_goals FOR UPDATE
  USING (public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner','Admin']))
  WITH CHECK (public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner','Admin']));
CREATE POLICY savings_goals_delete ON public.savings_goals FOR DELETE
  USING (public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner','Admin']));

CREATE POLICY savings_goal_contributions_select ON public.savings_goal_contributions FOR SELECT
  USING (public.is_workspace_member((SELECT auth.uid()), workspace_id));
CREATE POLICY savings_goal_contributions_insert ON public.savings_goal_contributions FOR INSERT
  WITH CHECK (created_by = (SELECT auth.uid())
    AND public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner','Admin','Member'])
    AND EXISTS (SELECT 1 FROM public.savings_goals goal
      WHERE goal.id = savings_goal_contributions.goal_id
        AND goal.workspace_id = savings_goal_contributions.workspace_id
        AND goal.status = 'active'));
CREATE POLICY savings_goal_contributions_update ON public.savings_goal_contributions FOR UPDATE
  USING ((public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner','Admin'])
    OR (created_by = (SELECT auth.uid()) AND public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Member'])))
    AND EXISTS (SELECT 1 FROM public.savings_goals goal
      WHERE goal.id = savings_goal_contributions.goal_id
        AND goal.workspace_id = savings_goal_contributions.workspace_id
        AND goal.status = 'active'))
  WITH CHECK ((public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner','Admin'])
    OR (created_by = (SELECT auth.uid()) AND public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Member'])))
    AND EXISTS (SELECT 1 FROM public.savings_goals goal
      WHERE goal.id = savings_goal_contributions.goal_id
        AND goal.workspace_id = savings_goal_contributions.workspace_id
        AND goal.status = 'active'));
CREATE POLICY savings_goal_contributions_delete ON public.savings_goal_contributions FOR DELETE
  USING (public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner','Admin'])
    OR (created_by = (SELECT auth.uid()) AND public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Member'])));

CREATE OR REPLACE FUNCTION public.get_savings_goal_progress(p_workspace_id uuid)
RETURNS TABLE (
  id uuid, name text, target_amount numeric, saved_amount numeric,
  remaining_amount numeric, progress_pct numeric, target_date date,
  account_id uuid, status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_workspace_member(auth.uid(), p_workspace_id) THEN
    RAISE EXCEPTION 'Недостаточно прав для просмотра целей';
  END IF;
  RETURN QUERY
  SELECT goal.id, goal.name, goal.target_amount,
    COALESCE(sum(contribution.amount), 0)::numeric AS saved_amount,
    greatest(goal.target_amount - COALESCE(sum(contribution.amount), 0), 0)::numeric AS remaining_amount,
    round(COALESCE(sum(contribution.amount), 0) / goal.target_amount * 100, 2)::numeric AS progress_pct,
    goal.target_date, goal.account_id, goal.status
  FROM public.savings_goals goal
  LEFT JOIN public.savings_goal_contributions contribution
    ON contribution.goal_id = goal.id AND contribution.workspace_id = goal.workspace_id
  WHERE goal.workspace_id = p_workspace_id
  GROUP BY goal.id
  ORDER BY (goal.status = 'active') DESC, goal.target_date NULLS LAST, goal.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_savings_goal_contribution(
  p_goal_id uuid, p_amount numeric, p_contribution_date date DEFAULT CURRENT_DATE,
  p_account_id uuid DEFAULT NULL, p_operation_id uuid DEFAULT NULL, p_note text DEFAULT NULL
)
RETURNS public.savings_goal_contributions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_goal public.savings_goals;
  v_result public.savings_goal_contributions;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Требуется авторизация'; END IF;
  SELECT * INTO v_goal FROM public.savings_goals WHERE id = p_goal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Цель не найдена'; END IF;
  IF NOT public.user_has_role(v_actor, v_goal.workspace_id, ARRAY['Owner','Admin','Member']) THEN
    RAISE EXCEPTION 'Недостаточно прав для пополнения цели';
  END IF;
  IF v_goal.status <> 'active' THEN RAISE EXCEPTION 'Пополнять можно только активную цель'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'Сумма пополнения должна быть положительной и округлена до 2 знаков';
  END IF;
  INSERT INTO public.savings_goal_contributions (
    workspace_id, goal_id, amount, contribution_date, account_id, operation_id, note, created_by
  ) VALUES (
    v_goal.workspace_id, v_goal.id, p_amount, COALESCE(p_contribution_date, CURRENT_DATE),
    COALESCE(p_account_id, v_goal.account_id), p_operation_id, NULLIF(btrim(p_note), ''), v_actor
  ) RETURNING * INTO v_result;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_savings_goal_status(p_goal_id uuid, p_status text)
RETURNS public.savings_goals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_actor uuid := auth.uid(); v_goal public.savings_goals;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Требуется авторизация'; END IF;
  SELECT * INTO v_goal FROM public.savings_goals WHERE id = p_goal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Цель не найдена'; END IF;
  IF NOT public.user_has_role(v_actor, v_goal.workspace_id, ARRAY['Owner','Admin']) THEN
    RAISE EXCEPTION 'Недостаточно прав для изменения статуса цели';
  END IF;
  IF p_status NOT IN ('active','paused','completed','cancelled') THEN RAISE EXCEPTION 'Некорректный статус цели'; END IF;
  IF p_status = v_goal.status THEN RETURN v_goal; END IF;
  IF NOT ((v_goal.status = 'active' AND p_status IN ('paused','completed','cancelled'))
    OR (v_goal.status = 'paused' AND p_status IN ('active','completed','cancelled'))
    OR (v_goal.status IN ('completed','cancelled') AND p_status = 'active')) THEN
    RAISE EXCEPTION 'Недопустимый переход статуса цели';
  END IF;
  UPDATE public.savings_goals SET status = p_status,
    completed_at = CASE WHEN p_status = 'completed' THEN now() ELSE NULL END
  WHERE id = p_goal_id RETURNING * INTO v_goal;
  RETURN v_goal;
END;
$$;

REVOKE ALL ON public.savings_goals, public.savings_goal_contributions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.savings_goals, public.savings_goal_contributions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.savings_goals, public.savings_goal_contributions TO service_role;

REVOKE ALL ON FUNCTION public.get_budget_category_spent_internal(uuid,uuid,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prepare_savings_goal_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_budget_period(uuid,uuid,date,numeric,text,numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_budget_progress(uuid,date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_savings_goal_progress(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.add_savings_goal_contribution(uuid,numeric,date,uuid,uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transition_savings_goal_status(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_budget_period(uuid,uuid,date,numeric,text,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_budget_progress(uuid,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_savings_goal_progress(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_savings_goal_contribution(uuid,numeric,date,uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_savings_goal_status(uuid,text) TO authenticated;

COMMIT;
