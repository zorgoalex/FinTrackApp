-- Monthly category budgets and server-side progress calculation.

BEGIN;

CREATE TABLE public.budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  month date NOT NULL CHECK (month = date_trunc('month', month)::date),
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, category_id, month)
);

CREATE INDEX idx_budgets_workspace_month ON public.budgets(workspace_id, month);

CREATE OR REPLACE FUNCTION public.validate_budget_category()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.categories c
    WHERE c.id = NEW.category_id
      AND c.workspace_id = NEW.workspace_id
      AND c.type = 'expense'
  ) THEN
    RAISE EXCEPTION 'Бюджет можно установить только для категории расходов этого пространства';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_budget_category
  BEFORE INSERT OR UPDATE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.validate_budget_category();

CREATE TRIGGER update_budgets_updated_at
  BEFORE UPDATE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY budgets_select ON public.budgets FOR SELECT
  USING (public.is_workspace_member(auth.uid(), workspace_id));

CREATE POLICY budgets_insert ON public.budgets FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND public.user_has_role(auth.uid(), workspace_id, ARRAY['Owner', 'Admin'])
  );

CREATE POLICY budgets_update ON public.budgets FOR UPDATE
  USING (public.user_has_role(auth.uid(), workspace_id, ARRAY['Owner', 'Admin']))
  WITH CHECK (public.user_has_role(auth.uid(), workspace_id, ARRAY['Owner', 'Admin']));

CREATE POLICY budgets_delete ON public.budgets FOR DELETE
  USING (public.user_has_role(auth.uid(), workspace_id, ARRAY['Owner', 'Admin']));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.budgets TO authenticated;

CREATE OR REPLACE FUNCTION public.get_budget_progress(
  p_workspace_id uuid,
  p_month date
)
RETURNS TABLE (
  id uuid,
  category_id uuid,
  amount numeric,
  spent numeric,
  remaining numeric,
  progress_pct numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    b.id,
    b.category_id,
    b.amount,
    COALESCE(SUM(o.base_amount), 0)::numeric AS spent,
    (b.amount - COALESCE(SUM(o.base_amount), 0))::numeric AS remaining,
    ROUND(COALESCE(SUM(o.base_amount), 0) / b.amount * 100, 2)::numeric AS progress_pct
  FROM public.budgets b
  LEFT JOIN public.operations o
    ON o.workspace_id = b.workspace_id
    AND o.category_id = b.category_id
    AND o.type IN ('expense', 'salary')
    AND o.operation_date >= b.month
    AND o.operation_date < (b.month + interval '1 month')::date
  WHERE b.workspace_id = p_workspace_id
    AND b.month = date_trunc('month', p_month)::date
  GROUP BY b.id, b.category_id, b.amount
  ORDER BY progress_pct DESC, b.amount DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_budget_progress(uuid, date) TO authenticated;

COMMIT;
