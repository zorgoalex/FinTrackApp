-- =====================================
-- Phase 6: Debts/Obligations/Credits
-- =====================================

BEGIN;

-- Debts table
CREATE TABLE public.debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (btrim(title) <> ''),
  counterparty text NOT NULL CHECK (btrim(counterparty) <> ''),
  direction text NOT NULL CHECK (direction IN ('i_owe', 'owed_to_me')),
  initial_amount numeric(14,2) NOT NULL CHECK (initial_amount > 0),
  opened_on date NOT NULL DEFAULT CURRENT_DATE,
  due_on date NULL,
  notes text NULL,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_debts_workspace ON public.debts(workspace_id);
CREATE INDEX idx_debts_workspace_archived ON public.debts(workspace_id, is_archived);
CREATE INDEX idx_debts_workspace_direction ON public.debts(workspace_id, direction);

-- Updated_at trigger
CREATE TRIGGER update_debts_updated_at
  BEFORE UPDATE ON public.debts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "debts_select_policy" ON public.debts FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = debts.workspace_id
      AND wm.user_id = auth.uid() AND wm.is_active = true
  ));

CREATE POLICY "debts_insert_policy" ON public.debts FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND user_has_role(auth.uid(), workspace_id, ARRAY['Owner'::text, 'Admin'::text, 'Member'::text])
  );

CREATE POLICY "debts_update_policy" ON public.debts FOR UPDATE
  USING (user_has_role(auth.uid(), workspace_id, ARRAY['Owner'::text, 'Admin'::text]))
  WITH CHECK (user_has_role(auth.uid(), workspace_id, ARRAY['Owner'::text, 'Admin'::text]));

CREATE POLICY "debts_delete_policy" ON public.debts FOR DELETE
  USING (user_has_role(auth.uid(), workspace_id, ARRAY['Owner'::text, 'Admin'::text]));

-- ==================
-- Operations: add debt link columns
-- ==================
ALTER TABLE public.operations
  ADD COLUMN IF NOT EXISTS debt_id uuid NULL REFERENCES public.debts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS debt_applied_amount numeric(14,2) NULL;

-- Constraint: both debt fields must be set together, applied <= amount
ALTER TABLE public.operations
  ADD CONSTRAINT operations_debt_pair_chk CHECK (
    (debt_id IS NULL AND debt_applied_amount IS NULL) OR
    (debt_id IS NOT NULL AND debt_applied_amount IS NOT NULL AND debt_applied_amount > 0 AND debt_applied_amount <= amount)
  );

-- Index for debt-linked operations lookup
CREATE INDEX IF NOT EXISTS idx_operations_workspace_debt
  ON public.operations(workspace_id, debt_id, operation_date DESC)
  WHERE debt_id IS NOT NULL;

-- ==================
-- Trigger: validate operation-debt compatibility
-- ==================
CREATE OR REPLACE FUNCTION public.validate_operation_debt()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_debt public.debts%ROWTYPE;
BEGIN
  -- Skip if no debt_id or debt_id unchanged on UPDATE
  IF NEW.debt_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.debt_id IS NOT DISTINCT FROM OLD.debt_id THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_debt FROM public.debts WHERE id = NEW.debt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Долг не найден';
  END IF;

  IF v_debt.workspace_id <> NEW.workspace_id THEN
    RAISE EXCEPTION 'Долг принадлежит другому пространству';
  END IF;

  IF v_debt.is_archived THEN
    RAISE EXCEPTION 'Нельзя привязать операцию к архивному долгу';
  END IF;

  -- Direction/type matrix
  IF v_debt.direction = 'i_owe' AND NEW.type <> 'expense' THEN
    RAISE EXCEPTION 'Долг "Я должен" можно привязать только к расходу';
  END IF;

  IF v_debt.direction = 'owed_to_me' AND NEW.type <> 'income' THEN
    RAISE EXCEPTION 'Долг "Мне должны" можно привязать только к доходу';
  END IF;

  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_operation_debt
  BEFORE INSERT OR UPDATE ON public.operations
  FOR EACH ROW EXECUTE FUNCTION public.validate_operation_debt();

-- ==================
-- RPC: get debts with computed balances
-- ==================
CREATE OR REPLACE FUNCTION public.get_debts_with_balance(p_workspace_id uuid)
RETURNS TABLE (
  id uuid,
  workspace_id uuid,
  created_by uuid,
  title text,
  counterparty text,
  direction text,
  initial_amount numeric,
  paid_amount numeric,
  remaining_amount numeric,
  progress_pct numeric,
  opened_on date,
  due_on date,
  notes text,
  is_archived boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql STABLE AS $$
  WITH paid AS (
    SELECT
      o.debt_id,
      COALESCE(SUM(o.debt_applied_amount), 0)::numeric AS paid_amount
    FROM public.operations o
    WHERE o.workspace_id = p_workspace_id
      AND o.debt_id IS NOT NULL
    GROUP BY o.debt_id
  )
  SELECT
    d.id,
    d.workspace_id,
    d.created_by,
    d.title,
    d.counterparty,
    d.direction,
    d.initial_amount,
    COALESCE(p.paid_amount, 0)::numeric AS paid_amount,
    GREATEST(d.initial_amount - COALESCE(p.paid_amount, 0), 0)::numeric AS remaining_amount,
    CASE
      WHEN d.initial_amount = 0 THEN 100
      ELSE ROUND(LEAST(COALESCE(p.paid_amount, 0) / d.initial_amount, 1) * 100, 2)
    END::numeric AS progress_pct,
    d.opened_on,
    d.due_on,
    d.notes,
    d.is_archived,
    d.created_at,
    d.updated_at
  FROM public.debts d
  LEFT JOIN paid p ON p.debt_id = d.id
  WHERE d.workspace_id = p_workspace_id
  ORDER BY d.is_archived ASC, remaining_amount DESC, d.updated_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_debts_with_balance(uuid) TO authenticated;

COMMIT;
