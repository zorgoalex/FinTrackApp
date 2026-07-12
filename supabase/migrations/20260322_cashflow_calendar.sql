-- One-off cash-flow plans and atomic conversion into actual operations.

BEGIN;

UPDATE public.scheduled_operations schedule
SET currency = account.currency
FROM public.accounts account
WHERE account.id = schedule.account_id AND account.workspace_id = schedule.workspace_id;

CREATE OR REPLACE FUNCTION public.sync_scheduled_operation_currency()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  SELECT currency INTO NEW.currency FROM public.accounts
  WHERE id = NEW.account_id AND workspace_id = NEW.workspace_id AND NOT is_archived;
  IF NEW.currency IS NULL THEN RAISE EXCEPTION 'Выберите активный счёт для расписания'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS scheduled_operations_sync_currency ON public.scheduled_operations;
CREATE TRIGGER scheduled_operations_sync_currency
  BEFORE INSERT OR UPDATE OF account_id ON public.scheduled_operations
  FOR EACH ROW EXECUTE FUNCTION public.sync_scheduled_operation_currency();

CREATE TABLE public.cashflow_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  direction text NOT NULL CHECK (direction IN ('income', 'expense')),
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'KZT',
  exchange_rate numeric(20,8) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  base_amount numeric(15,2) NOT NULL CHECK (base_amount > 0),
  planned_date date NOT NULL,
  account_id uuid NOT NULL,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  notes text,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'completed', 'cancelled')),
  linked_operation_id uuid REFERENCES public.operations(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (account_id, workspace_id) REFERENCES public.accounts(id, workspace_id) ON DELETE RESTRICT
);

CREATE INDEX cashflow_plans_workspace_date_idx
  ON public.cashflow_plans(workspace_id, planned_date, status);

CREATE TRIGGER update_cashflow_plans_updated_at
  BEFORE UPDATE ON public.cashflow_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.cashflow_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY cashflow_plans_select ON public.cashflow_plans FOR SELECT
  USING (public.is_workspace_member((SELECT auth.uid()), workspace_id));
CREATE POLICY cashflow_plans_insert ON public.cashflow_plans FOR INSERT
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin', 'Member'])
  );
CREATE POLICY cashflow_plans_update ON public.cashflow_plans FOR UPDATE
  USING (created_by = (SELECT auth.uid()) OR public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin']))
  WITH CHECK (public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin', 'Member']));
CREATE POLICY cashflow_plans_delete ON public.cashflow_plans FOR DELETE
  USING (created_by = (SELECT auth.uid()) OR public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin']));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cashflow_plans TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_cashflow_plan(p_plan_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_plan public.cashflow_plans%ROWTYPE;
  v_operation_id uuid;
BEGIN
  SELECT * INTO v_plan FROM public.cashflow_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Плановый платёж не найден'; END IF;
  IF v_user_id IS NULL OR NOT public.user_has_role(v_user_id, v_plan.workspace_id, ARRAY['Owner', 'Admin', 'Member']) THEN
    RAISE EXCEPTION 'Нет права проводить платёж';
  END IF;
  IF v_plan.status <> 'planned' THEN RAISE EXCEPTION 'Платёж уже обработан'; END IF;

  INSERT INTO public.operations (
    workspace_id, user_id, amount, type, description, operation_date,
    category_id, account_id, currency, exchange_rate, base_amount
  ) VALUES (
    v_plan.workspace_id, v_user_id, v_plan.amount, v_plan.direction,
    v_plan.title, CURRENT_DATE, v_plan.category_id, v_plan.account_id,
    v_plan.currency, v_plan.exchange_rate, v_plan.base_amount
  ) RETURNING id INTO v_operation_id;

  UPDATE public.cashflow_plans SET
    status = 'completed', linked_operation_id = v_operation_id,
    completed_at = now(), updated_at = now()
  WHERE id = p_plan_id;
  RETURN v_operation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_cashflow_plan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_cashflow_plan(uuid) TO authenticated;

COMMIT;
