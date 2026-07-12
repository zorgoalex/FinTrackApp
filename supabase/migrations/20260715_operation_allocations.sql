-- P1 split transactions: workspace-safe allocations and atomic write RPCs.

BEGIN;

ALTER TABLE public.operations
  ADD CONSTRAINT operations_id_workspace_unique UNIQUE (id, workspace_id);

CREATE TABLE public.operation_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  category_id uuid NOT NULL,
  counterparty_id uuid,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  base_amount numeric(15,2) NOT NULL CHECK (base_amount > 0),
  position integer NOT NULL CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operation_allocations_operation_workspace_fkey
    FOREIGN KEY (operation_id, workspace_id)
    REFERENCES public.operations(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT operation_allocations_category_workspace_fkey
    FOREIGN KEY (category_id, workspace_id)
    REFERENCES public.categories(id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT operation_allocations_counterparty_workspace_fkey
    FOREIGN KEY (counterparty_id, workspace_id)
    REFERENCES public.counterparties(id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT operation_allocations_operation_position_key
    UNIQUE (operation_id, position)
);

CREATE INDEX operation_allocations_workspace_category_idx
  ON public.operation_allocations(workspace_id, category_id, operation_id);
CREATE INDEX operation_allocations_workspace_counterparty_idx
  ON public.operation_allocations(workspace_id, counterparty_id)
  WHERE counterparty_id IS NOT NULL;

CREATE TRIGGER update_operation_allocations_updated_at
  BEFORE UPDATE ON public.operation_allocations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.validate_operation_allocation_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operation_id uuid := CASE WHEN TG_TABLE_NAME = 'operations'
    THEN COALESCE(NEW.id, OLD.id) ELSE COALESCE(NEW.operation_id, OLD.operation_id) END;
  v_operation public.operations;
  v_count integer;
  v_amount numeric;
  v_base_amount numeric;
BEGIN
  SELECT * INTO v_operation FROM public.operations WHERE id = v_operation_id;
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  SELECT count(*), COALESCE(sum(amount), 0), COALESCE(sum(base_amount), 0)
  INTO v_count, v_amount, v_base_amount
  FROM public.operation_allocations WHERE operation_id = v_operation_id;
  IF v_count > 0 AND (v_amount <> v_operation.amount OR v_base_amount <> v_operation.base_amount) THEN
    RAISE EXCEPTION 'Сумма распределений должна совпадать с суммой операции';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER operation_allocation_totals_from_operation
  AFTER INSERT OR UPDATE ON public.operations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.validate_operation_allocation_totals();
CREATE CONSTRAINT TRIGGER operation_allocation_totals_from_allocation
  AFTER INSERT OR UPDATE OR DELETE ON public.operation_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.validate_operation_allocation_totals();

ALTER TABLE public.operation_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY operation_allocations_select ON public.operation_allocations FOR SELECT
  USING (public.is_workspace_member((SELECT auth.uid()), workspace_id));

-- Allocation writes deliberately have no authenticated table policy. Financial
-- invariants and status changes must pass through the atomic RPCs below.
REVOKE ALL ON public.operation_allocations FROM anon, authenticated;
GRANT SELECT ON public.operation_allocations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operation_allocations TO service_role;

CREATE OR REPLACE FUNCTION public.write_operation_allocations_internal(
  p_operation public.operations,
  p_allocations jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item record;
  v_category_id uuid;
  v_counterparty_id uuid;
  v_amount numeric;
  v_base_amount numeric;
  v_total_amount numeric := 0;
  v_total_base_amount numeric := 0;
  v_count integer;
  v_expected_category_type text;
BEGIN
  IF p_operation.type = 'transfer' THEN
    RAISE EXCEPTION 'Переводы нельзя разбивать по категориям';
  END IF;
  IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array' THEN
    RAISE EXCEPTION 'Распределения должны быть JSON-массивом';
  END IF;

  v_count := jsonb_array_length(p_allocations);
  IF v_count > 100 THEN
    RAISE EXCEPTION 'Допускается не более 100 распределений';
  END IF;
  v_expected_category_type := CASE
    WHEN p_operation.type IN ('income', 'personal_salary') THEN 'income'
    ELSE 'expense'
  END;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.fintrack_allocations_input (
    position integer, category_id uuid, counterparty_id uuid,
    amount numeric(15,2), base_amount numeric(15,2)
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.fintrack_allocations_input;

  FOR v_item IN
    SELECT value, ordinality - 1 AS position
    FROM jsonb_array_elements(p_allocations) WITH ORDINALITY
  LOOP
    BEGIN
      v_category_id := NULLIF(v_item.value ->> 'category_id', '')::uuid;
      v_counterparty_id := NULLIF(v_item.value ->> 'counterparty_id', '')::uuid;
      v_amount := (v_item.value ->> 'amount')::numeric;
      v_base_amount := (v_item.value ->> 'base_amount')::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Некорректное распределение в позиции %', v_item.position;
    END;

    IF v_category_id IS NULL OR v_amount IS NULL OR v_base_amount IS NULL
       OR v_amount <= 0 OR v_base_amount <= 0
       OR v_amount <> round(v_amount, 2)
       OR v_base_amount <> round(v_base_amount, 2) THEN
      RAISE EXCEPTION 'Суммы распределения в позиции % должны быть положительными и округлены до 2 знаков', v_item.position;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.categories category
      WHERE category.id = v_category_id
        AND category.workspace_id = p_operation.workspace_id
        AND NOT category.is_archived
        AND category.type = v_expected_category_type
    ) THEN
      RAISE EXCEPTION 'Категория распределения не найдена, архивирована или не соответствует типу операции';
    END IF;

    IF v_counterparty_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.counterparties counterparty
      WHERE counterparty.id = v_counterparty_id
        AND counterparty.workspace_id = p_operation.workspace_id
        AND NOT counterparty.is_archived
    ) THEN
      RAISE EXCEPTION 'Контрагент распределения не найден или находится в архиве';
    END IF;

    INSERT INTO pg_temp.fintrack_allocations_input
      (position, category_id, counterparty_id, amount, base_amount)
    VALUES
      (v_item.position, v_category_id, v_counterparty_id, v_amount, v_base_amount);
    v_total_amount := v_total_amount + v_amount;
    v_total_base_amount := v_total_base_amount + v_base_amount;
  END LOOP;

  IF v_count > 0 AND (
    v_total_amount <> p_operation.amount
    OR v_total_base_amount <> p_operation.base_amount
  ) THEN
    RAISE EXCEPTION 'Сумма распределений должна точно совпадать с суммой операции (%, %)',
      p_operation.amount, p_operation.base_amount;
  END IF;

  DELETE FROM public.operation_allocations
  WHERE operation_id = p_operation.id;

  INSERT INTO public.operation_allocations (
    workspace_id, operation_id, category_id, counterparty_id,
    amount, base_amount, position
  )
  SELECT p_operation.workspace_id, p_operation.id, input.category_id,
    input.counterparty_id, input.amount, input.base_amount, input.position
  FROM pg_temp.fintrack_allocations_input input
  ORDER BY input.position;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_operation_allocations(
  p_operation_id uuid,
  p_allocations jsonb
)
RETURNS public.operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_operation public.operations;
  v_role text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Требуется авторизация'; END IF;

  SELECT * INTO v_operation FROM public.operations
  WHERE id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Операция не найдена'; END IF;

  v_role := public.get_user_role_in_workspace(v_operation.workspace_id, v_actor);
  IF v_role NOT IN ('Owner', 'Admin')
     AND NOT (v_role = 'Member' AND v_operation.user_id = v_actor) THEN
    RAISE EXCEPTION 'Недостаточно прав для изменения распределений';
  END IF;
  IF v_operation.status = 'reconciled' THEN
    RAISE EXCEPTION 'Сверенную операцию сначала необходимо вернуть на проверку';
  END IF;

  PERFORM public.write_operation_allocations_internal(v_operation, p_allocations);

  IF v_operation.status = 'verified' THEN
    PERFORM set_config('fintrack.status_transition', 'on', true);
    UPDATE public.operations SET
      status = 'new', verified_at = NULL, verified_by = NULL,
      reconciled_at = NULL, reconciled_by = NULL
    WHERE id = v_operation.id RETURNING * INTO v_operation;
    INSERT INTO public.operation_status_events (
      workspace_id, operation_id, from_status, to_status, actor_id, reason
    ) VALUES (
      v_operation.workspace_id, v_operation.id, 'verified', 'new', v_actor,
      'Изменено распределение операции'
    );
  END IF;

  RETURN v_operation;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_operation_with_allocations(
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
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_operation public.operations;
  v_role text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Требуется авторизация'; END IF;
  v_role := public.get_user_role_in_workspace(p_workspace_id, v_actor);
  IF v_role NOT IN ('Owner', 'Admin', 'Member') THEN
    RAISE EXCEPTION 'Недостаточно прав для создания операции';
  END IF;
  IF p_type NOT IN ('income', 'expense', 'personal_salary', 'employee_salary') THEN
    RAISE EXCEPTION 'Некорректный тип операции';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, 2)
     OR p_base_amount IS NULL OR p_base_amount <= 0 OR p_base_amount <> round(p_base_amount, 2)
     OR p_exchange_rate IS NULL OR p_exchange_rate <= 0 THEN
    RAISE EXCEPTION 'Сумма, базовая сумма и курс должны быть корректными';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.accounts account
    WHERE account.id = p_account_id AND account.workspace_id = p_workspace_id
      AND NOT account.is_archived AND account.currency = upper(p_currency)
  ) THEN
    RAISE EXCEPTION 'Счёт не найден, архивирован или имеет другую валюту';
  END IF;
  IF p_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.categories category
    WHERE category.id = p_category_id AND category.workspace_id = p_workspace_id
      AND NOT category.is_archived AND category.type = CASE
        WHEN p_type IN ('income', 'personal_salary') THEN 'income' ELSE 'expense' END
  ) THEN RAISE EXCEPTION 'Категория не найдена или не соответствует операции'; END IF;

  INSERT INTO public.operations (
    workspace_id, user_id, amount, type, description, operation_date,
    category_id, counterparty_id, account_id, currency, exchange_rate,
    base_amount, debt_id, debt_applied_amount, status
  ) VALUES (
    p_workspace_id, v_actor, p_amount, p_type, NULLIF(btrim(p_description), ''),
    COALESCE(p_operation_date, CURRENT_DATE), p_category_id, p_counterparty_id,
    p_account_id, upper(p_currency), p_exchange_rate, p_base_amount,
    p_debt_id, p_debt_applied_amount, 'verified'
  ) RETURNING * INTO v_operation;

  PERFORM public.write_operation_allocations_internal(v_operation, p_allocations);

  IF cardinality(COALESCE(p_tag_names, '{}'::text[])) > 20 OR EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_tag_names, '{}'::text[])) name
    WHERE char_length(btrim(name)) NOT BETWEEN 1 AND 50
  ) THEN RAISE EXCEPTION 'Один или несколько тегов некорректны'; END IF;
  INSERT INTO public.tags(workspace_id, name, color, is_archived)
  SELECT DISTINCT p_workspace_id, btrim(name), '#6B7280', false
  FROM unnest(COALESCE(p_tag_names, '{}'::text[])) name
  ON CONFLICT (workspace_id, name) DO UPDATE SET is_archived = false;
  INSERT INTO public.operation_tags(operation_id, tag_id)
  SELECT v_operation.id, tag.id FROM public.tags tag
  WHERE tag.workspace_id = p_workspace_id
    AND tag.name IN (SELECT btrim(name) FROM unnest(COALESCE(p_tag_names, '{}'::text[])) name)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.operation_status_events (
    workspace_id, operation_id, from_status, to_status, actor_id, reason
  ) VALUES (p_workspace_id, v_operation.id, NULL, 'verified', v_actor, 'Создано вручную');
  RETURN v_operation;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_operation_with_allocations(
  p_operation_id uuid,
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
  p_allocations jsonb,
  p_tag_names text[] DEFAULT NULL
)
RETURNS public.operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_operation public.operations;
  v_role text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Требуется авторизация'; END IF;
  SELECT * INTO v_operation FROM public.operations WHERE id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Операция не найдена'; END IF;
  v_role := public.get_user_role_in_workspace(v_operation.workspace_id, v_actor);
  IF v_role NOT IN ('Owner', 'Admin')
     AND NOT (v_role = 'Member' AND v_operation.user_id = v_actor) THEN
    RAISE EXCEPTION 'Недостаточно прав для изменения операции';
  END IF;
  IF v_operation.status = 'reconciled' THEN
    RAISE EXCEPTION 'Сверенную операцию сначала необходимо вернуть на проверку';
  END IF;
  IF p_type NOT IN ('income', 'expense', 'personal_salary', 'employee_salary')
     OR p_amount IS NULL OR p_amount <= 0 OR p_amount <> round(p_amount, 2)
     OR p_base_amount IS NULL OR p_base_amount <= 0 OR p_base_amount <> round(p_base_amount, 2)
     OR p_exchange_rate IS NULL OR p_exchange_rate <= 0 THEN
    RAISE EXCEPTION 'Некорректные финансовые реквизиты операции';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.accounts account
    WHERE account.id = p_account_id AND account.workspace_id = v_operation.workspace_id
      AND NOT account.is_archived AND account.currency = upper(p_currency)
  ) THEN RAISE EXCEPTION 'Счёт не найден, архивирован или имеет другую валюту'; END IF;
  IF p_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.categories category
    WHERE category.id = p_category_id AND category.workspace_id = v_operation.workspace_id
      AND NOT category.is_archived AND category.type = CASE
        WHEN p_type IN ('income', 'personal_salary') THEN 'income' ELSE 'expense' END
  ) THEN RAISE EXCEPTION 'Категория не найдена или не соответствует операции'; END IF;

  UPDATE public.operations SET
    amount = p_amount, type = p_type, description = NULLIF(btrim(p_description), ''),
    operation_date = COALESCE(p_operation_date, CURRENT_DATE),
    category_id = p_category_id, counterparty_id = p_counterparty_id,
    account_id = p_account_id, currency = upper(p_currency),
    exchange_rate = p_exchange_rate, base_amount = p_base_amount,
    debt_id = p_debt_id, debt_applied_amount = p_debt_applied_amount
  WHERE id = p_operation_id RETURNING * INTO v_operation;

  PERFORM public.write_operation_allocations_internal(v_operation, p_allocations);
  IF v_operation.status = 'verified' THEN
    PERFORM set_config('fintrack.status_transition', 'on', true);
    UPDATE public.operations SET status = 'new', verified_at = NULL, verified_by = NULL,
      reconciled_at = NULL, reconciled_by = NULL
    WHERE id = p_operation_id RETURNING * INTO v_operation;
    INSERT INTO public.operation_status_events (
      workspace_id, operation_id, from_status, to_status, actor_id, reason
    ) VALUES (v_operation.workspace_id, v_operation.id, 'verified', 'new', v_actor,
      'Изменено распределение операции');
  END IF;

  IF p_tag_names IS NOT NULL THEN
    IF cardinality(p_tag_names) > 20 OR EXISTS (
      SELECT 1 FROM unnest(p_tag_names) name
      WHERE char_length(btrim(name)) NOT BETWEEN 1 AND 50
    ) THEN RAISE EXCEPTION 'Один или несколько тегов некорректны'; END IF;
    INSERT INTO public.tags(workspace_id, name, color, is_archived)
    SELECT DISTINCT v_operation.workspace_id, btrim(name), '#6B7280', false
    FROM unnest(p_tag_names) name
    ON CONFLICT (workspace_id, name) DO UPDATE SET is_archived = false;
    DELETE FROM public.operation_tags WHERE operation_id = p_operation_id;
    INSERT INTO public.operation_tags(operation_id, tag_id)
    SELECT p_operation_id, tag.id FROM public.tags tag
    WHERE tag.workspace_id = v_operation.workspace_id
      AND tag.name IN (SELECT btrim(name) FROM unnest(p_tag_names) name)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN v_operation;
END;
$$;

-- Split rows supersede the legacy operation category. Operations without rows
-- retain the old category_id semantics, so existing clients remain correct.
CREATE OR REPLACE FUNCTION public.get_budget_progress(p_workspace_id uuid, p_month date)
RETURNS TABLE (id uuid, category_id uuid, amount numeric, spent numeric, remaining numeric, progress_pct numeric)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH operation_spend AS (
    SELECT operation.workspace_id, allocation.category_id,
      operation.operation_date, allocation.base_amount
    FROM public.operations operation
    JOIN public.operation_allocations allocation ON allocation.operation_id = operation.id
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
  SELECT budget.id, budget.category_id, budget.amount,
    COALESCE(SUM(spend.base_amount), 0)::numeric AS spent,
    (budget.amount - COALESCE(SUM(spend.base_amount), 0))::numeric AS remaining,
    ROUND(COALESCE(SUM(spend.base_amount), 0) / budget.amount * 100, 2)::numeric AS progress_pct
  FROM public.budgets budget
  LEFT JOIN operation_spend spend
    ON spend.workspace_id = budget.workspace_id
    AND spend.category_id = budget.category_id
    AND spend.operation_date >= budget.month
    AND spend.operation_date < (budget.month + interval '1 month')::date
  WHERE budget.workspace_id = p_workspace_id
    AND budget.month = date_trunc('month', p_month)::date
  GROUP BY budget.id, budget.category_id, budget.amount
  ORDER BY progress_pct DESC, budget.amount DESC;
$$;

REVOKE ALL ON FUNCTION public.write_operation_allocations_internal(public.operations, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_operation_allocation_totals() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.replace_operation_allocations(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_operation_with_allocations(uuid, numeric, text, text, date, uuid, uuid, uuid, text, numeric, numeric, uuid, numeric, jsonb, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_operation_with_allocations(uuid, numeric, text, text, date, uuid, uuid, uuid, text, numeric, numeric, uuid, numeric, jsonb, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_operation_allocations(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_operation_with_allocations(uuid, numeric, text, text, date, uuid, uuid, uuid, text, numeric, numeric, uuid, numeric, jsonb, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_operation_with_allocations(uuid, numeric, text, text, date, uuid, uuid, uuid, text, numeric, numeric, uuid, numeric, jsonb, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_budget_progress(uuid, date) TO authenticated;

COMMIT;
