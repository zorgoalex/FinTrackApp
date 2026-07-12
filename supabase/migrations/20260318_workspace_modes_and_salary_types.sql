-- Two product modes and unambiguous salary cash-flow semantics.

BEGIN;

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS workspace_type text;

UPDATE public.workspaces
SET workspace_type = CASE WHEN is_personal THEN 'personal' ELSE 'business' END
WHERE workspace_type IS NULL;

ALTER TABLE public.workspaces
  ALTER COLUMN workspace_type SET DEFAULT 'business',
  ALTER COLUMN workspace_type SET NOT NULL;

ALTER TABLE public.workspaces DROP CONSTRAINT IF EXISTS workspaces_workspace_type_check;
ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_workspace_type_check
  CHECK (workspace_type IN ('personal', 'business'));

-- Seed a useful, mode-specific chart of categories. Existing custom categories
-- remain untouched because the category key is unique per workspace/name/type.
CREATE OR REPLACE FUNCTION public.seed_workspace_categories(
  p_workspace_id uuid,
  p_workspace_type text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_workspace_type = 'personal' THEN
    INSERT INTO public.categories (workspace_id, name, type, color) VALUES
      (p_workspace_id, 'Личная зарплата', 'income', '#16A34A'),
      (p_workspace_id, 'Фриланс', 'income', '#22C55E'),
      (p_workspace_id, 'Подарки', 'income', '#84CC16'),
      (p_workspace_id, 'Инвестиции', 'income', '#14B8A6'),
      (p_workspace_id, 'Прочие доходы', 'income', '#6B7280'),
      (p_workspace_id, 'Продукты', 'expense', '#F97316'),
      (p_workspace_id, 'Жильё', 'expense', '#8B5CF6'),
      (p_workspace_id, 'Коммунальные услуги', 'expense', '#6366F1'),
      (p_workspace_id, 'Транспорт', 'expense', '#0EA5E9'),
      (p_workspace_id, 'Здоровье', 'expense', '#EF4444'),
      (p_workspace_id, 'Развлечения', 'expense', '#EC4899'),
      (p_workspace_id, 'Образование', 'expense', '#3B82F6'),
      (p_workspace_id, 'Покупки', 'expense', '#A855F7'),
      (p_workspace_id, 'Путешествия', 'expense', '#06B6D4'),
      (p_workspace_id, 'Прочие расходы', 'expense', '#6B7280')
    ON CONFLICT (workspace_id, name, type) DO NOTHING;
  ELSE
    INSERT INTO public.categories (workspace_id, name, type, color) VALUES
      (p_workspace_id, 'Продажи', 'income', '#16A34A'),
      (p_workspace_id, 'Услуги', 'income', '#22C55E'),
      (p_workspace_id, 'Абонентская выручка', 'income', '#14B8A6'),
      (p_workspace_id, 'Прочие доходы', 'income', '#6B7280'),
      (p_workspace_id, 'Зарплаты сотрудникам', 'expense', '#4F46E5'),
      (p_workspace_id, 'Налоги и обязательные платежи', 'expense', '#DC2626'),
      (p_workspace_id, 'Аренда', 'expense', '#8B5CF6'),
      (p_workspace_id, 'Закупки и себестоимость', 'expense', '#F97316'),
      (p_workspace_id, 'Маркетинг и реклама', 'expense', '#EC4899'),
      (p_workspace_id, 'Транспорт и доставка', 'expense', '#0EA5E9'),
      (p_workspace_id, 'ПО и подписки', 'expense', '#3B82F6'),
      (p_workspace_id, 'Банковские комиссии', 'expense', '#64748B'),
      (p_workspace_id, 'Командировки', 'expense', '#06B6D4'),
      (p_workspace_id, 'Офисные расходы', 'expense', '#A855F7'),
      (p_workspace_id, 'Прочие расходы', 'expense', '#6B7280')
    ON CONFLICT (workspace_id, name, type) DO NOTHING;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.seed_workspace_categories_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_workspace_categories(NEW.id, NEW.workspace_type);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workspaces_seed_categories ON public.workspaces;
CREATE TRIGGER workspaces_seed_categories
AFTER INSERT ON public.workspaces
FOR EACH ROW EXECUTE FUNCTION public.seed_workspace_categories_trigger();

SELECT public.seed_workspace_categories(id, workspace_type) FROM public.workspaces;

-- Atomic creation prevents an orphan workspace when membership creation fails.
CREATE OR REPLACE FUNCTION public.create_workspace(p_name text, p_workspace_type text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Требуется авторизация'; END IF;
  IF btrim(COALESCE(p_name, '')) = '' OR char_length(btrim(p_name)) > 120 THEN
    RAISE EXCEPTION 'Название должно содержать от 1 до 120 символов';
  END IF;
  IF p_workspace_type NOT IN ('personal', 'business') THEN
    RAISE EXCEPTION 'Выберите тип пространства';
  END IF;

  INSERT INTO public.workspaces (owner_id, name, is_personal, workspace_type)
  VALUES (v_user_id, btrim(p_name), false, p_workspace_type)
  RETURNING id INTO v_workspace_id;

  INSERT INTO public.workspace_members (workspace_id, user_id, role, is_active, joined_at, invited_at)
  VALUES (v_workspace_id, v_user_id, 'Owner', true, now(), now());
  RETURN v_workspace_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_personal_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_workspace_id uuid;
BEGIN
  INSERT INTO public.workspaces (owner_id, name, is_personal, workspace_type)
  VALUES (NEW.id, 'Личное пространство', true, 'personal')
  RETURNING id INTO v_workspace_id;
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (v_workspace_id, NEW.id, 'Owner');
  RETURN NEW;
END;
$$;

-- Replace the ambiguous legacy salary type with directional types.
ALTER TABLE public.operations DROP CONSTRAINT IF EXISTS operations_type_check;
UPDATE public.operations o
SET type = CASE WHEN w.workspace_type = 'business' THEN 'employee_salary' ELSE 'personal_salary' END
FROM public.workspaces w
WHERE o.workspace_id = w.id AND o.type = 'salary';
ALTER TABLE public.operations ADD CONSTRAINT operations_type_check
  CHECK (type IN ('income', 'expense', 'personal_salary', 'employee_salary', 'transfer'));

ALTER TABLE public.scheduled_operations DROP CONSTRAINT IF EXISTS scheduled_operations_type_check;
UPDATE public.scheduled_operations s
SET type = CASE WHEN w.workspace_type = 'business' THEN 'employee_salary' ELSE 'personal_salary' END
FROM public.workspaces w
WHERE s.workspace_id = w.id AND s.type = 'salary';
ALTER TABLE public.scheduled_operations ADD CONSTRAINT scheduled_operations_type_check
  CHECK (type IN ('income', 'expense', 'personal_salary', 'employee_salary'));

CREATE OR REPLACE FUNCTION public.get_account_balances(p_workspace_id uuid)
RETURNS TABLE (account_id uuid, currency text, balance numeric, base_balance numeric)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT a.id, a.currency,
    COALESCE(SUM(CASE
      WHEN o.type IN ('income', 'personal_salary') OR (o.type = 'transfer' AND o.transfer_direction = 'in') THEN o.amount
      WHEN o.type IN ('expense', 'employee_salary') OR (o.type = 'transfer' AND o.transfer_direction = 'out') THEN -o.amount
      ELSE 0 END), 0)::numeric,
    COALESCE(SUM(CASE
      WHEN o.type IN ('income', 'personal_salary') OR (o.type = 'transfer' AND o.transfer_direction = 'in') THEN o.base_amount
      WHEN o.type IN ('expense', 'employee_salary') OR (o.type = 'transfer' AND o.transfer_direction = 'out') THEN -o.base_amount
      ELSE 0 END), 0)::numeric
  FROM public.accounts a LEFT JOIN public.operations o
    ON o.account_id = a.id AND o.workspace_id = p_workspace_id
  WHERE a.workspace_id = p_workspace_id AND NOT a.is_archived
  GROUP BY a.id, a.currency;
$$;

CREATE OR REPLACE FUNCTION public.get_workspace_operation_summary(p_workspace_id uuid, p_today date DEFAULT CURRENT_DATE)
RETURNS TABLE (period text, income numeric, expense numeric, salary numeric, total numeric)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_workspace_member(auth.uid(), p_workspace_id) THEN RAISE EXCEPTION 'Нет доступа к рабочему пространству'; END IF;
  RETURN QUERY WITH periods AS (
    SELECT 'today'::text n, p_today f, p_today t UNION ALL
    SELECT 'month', date_trunc('month', p_today)::date, (date_trunc('month', p_today) + interval '1 month - 1 day')::date
  ), totals AS (
    SELECT p.n,
      COALESCE(SUM(o.base_amount) FILTER (WHERE o.type IN ('income', 'personal_salary')), 0) i,
      COALESCE(SUM(o.base_amount) FILTER (WHERE o.type = 'expense'), 0) e,
      COALESCE(SUM(o.base_amount) FILTER (WHERE o.type = 'employee_salary'), 0) s
    FROM periods p LEFT JOIN public.operations o ON o.workspace_id = p_workspace_id
      AND o.operation_date BETWEEN p.f AND p.t
      AND o.type IN ('income', 'expense', 'personal_salary', 'employee_salary') GROUP BY p.n
  ) SELECT n, i, e, s, i - e - s FROM totals ORDER BY CASE n WHEN 'today' THEN 1 ELSE 2 END;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_workspace_operation_totals(p_workspace_id uuid, p_date_from date DEFAULT NULL, p_date_to date DEFAULT NULL)
RETURNS TABLE (income numeric, expense numeric, salary numeric, balance numeric)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_workspace_member(auth.uid(), p_workspace_id) THEN RAISE EXCEPTION 'Нет доступа к рабочему пространству'; END IF;
  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from > p_date_to THEN RAISE EXCEPTION 'Начальная дата не может быть позже конечной'; END IF;
  RETURN QUERY SELECT
    COALESCE(SUM(o.base_amount) FILTER (WHERE o.type IN ('income', 'personal_salary')), 0),
    COALESCE(SUM(o.base_amount) FILTER (WHERE o.type = 'expense'), 0),
    COALESCE(SUM(o.base_amount) FILTER (WHERE o.type = 'employee_salary'), 0),
    COALESCE(SUM(CASE WHEN o.type IN ('income', 'personal_salary') THEN o.base_amount WHEN o.type IN ('expense', 'employee_salary') THEN -o.base_amount ELSE 0 END), 0)
  FROM public.operations o WHERE o.workspace_id = p_workspace_id
    AND (p_date_from IS NULL OR o.operation_date >= p_date_from)
    AND (p_date_to IS NULL OR o.operation_date <= p_date_to)
    AND o.type IN ('income', 'expense', 'personal_salary', 'employee_salary');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_budget_progress(p_workspace_id uuid, p_month date)
RETURNS TABLE (id uuid, category_id uuid, amount numeric, spent numeric, remaining numeric, progress_pct numeric)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT b.id, b.category_id, b.amount, COALESCE(SUM(o.base_amount), 0)::numeric,
    (b.amount - COALESCE(SUM(o.base_amount), 0))::numeric,
    ROUND(COALESCE(SUM(o.base_amount), 0) / b.amount * 100, 2)::numeric
  FROM public.budgets b LEFT JOIN public.operations o ON o.workspace_id = b.workspace_id
    AND o.category_id = b.category_id AND o.type IN ('expense', 'employee_salary')
    AND o.operation_date >= b.month AND o.operation_date < (b.month + interval '1 month')::date
  WHERE b.workspace_id = p_workspace_id AND b.month = date_trunc('month', p_month)::date
  GROUP BY b.id, b.category_id, b.amount ORDER BY 6 DESC, b.amount DESC;
$$;

-- Keep the role-scoped, read-only AI context in sync without duplicating its
-- sizeable security-sensitive definition in this migration.
DO $$
DECLARE v_definition text;
BEGIN
  SELECT pg_get_functiondef('public.get_ai_financial_context(uuid,date,date)'::regprocedure)
  INTO v_definition;
  v_definition := replace(v_definition, 'o.type IN (''income'', ''expense'', ''salary'')', 'o.type IN (''income'', ''personal_salary'', ''expense'', ''employee_salary'')');
  v_definition := replace(v_definition, 'o.type IN (''expense'', ''salary'')', 'o.type IN (''expense'', ''employee_salary'')');
  v_definition := replace(v_definition, 'o.type = ''income''', 'o.type IN (''income'', ''personal_salary'')');
  EXECUTE v_definition;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_workspace_categories(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seed_workspace_categories_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_workspace(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_workspace(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_account_balances(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workspace_operation_summary(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workspace_operation_totals(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_budget_progress(uuid, date) TO authenticated;

COMMIT;
