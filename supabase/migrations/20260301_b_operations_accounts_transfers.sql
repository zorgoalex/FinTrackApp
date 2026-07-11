-- =====================================
-- Phase 6: Operations account_id + transfer support
-- =====================================

BEGIN;

-- New columns on operations
ALTER TABLE public.operations
  ADD COLUMN IF NOT EXISTS account_id uuid,
  ADD COLUMN IF NOT EXISTS transfer_group_id uuid,
  ADD COLUMN IF NOT EXISTS transfer_direction text,
  ADD COLUMN IF NOT EXISTS linked_operation_id uuid;

-- Update type CHECK to include 'transfer'
ALTER TABLE public.operations DROP CONSTRAINT IF EXISTS operations_type_check;
ALTER TABLE public.operations
  ADD CONSTRAINT operations_type_check CHECK (type IN ('income', 'expense', 'salary', 'transfer'));

-- Transfer integrity constraint
ALTER TABLE public.operations
  ADD CONSTRAINT operations_transfer_fields_check CHECK (
    (type = 'transfer' AND transfer_group_id IS NOT NULL AND transfer_direction IN ('in', 'out'))
    OR
    (type <> 'transfer' AND transfer_group_id IS NULL AND linked_operation_id IS NULL AND transfer_direction IS NULL)
  );

-- FK: account_id → accounts (compound with workspace_id)
ALTER TABLE public.operations
  ADD CONSTRAINT fk_operations_account_workspace
  FOREIGN KEY (account_id, workspace_id) REFERENCES public.accounts(id, workspace_id) ON DELETE RESTRICT;

-- FK: linked_operation_id → operations (DEFERRED for transfer pair insert)
ALTER TABLE public.operations
  ADD CONSTRAINT fk_operations_linked_operation
  FOREIGN KEY (linked_operation_id) REFERENCES public.operations(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

-- No self-reference
ALTER TABLE public.operations
  ADD CONSTRAINT operations_no_self_link CHECK (linked_operation_id IS NULL OR linked_operation_id <> id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_operations_workspace_account_date
  ON public.operations(workspace_id, account_id, operation_date DESC);

CREATE INDEX IF NOT EXISTS idx_operations_transfer_group
  ON public.operations(transfer_group_id) WHERE type = 'transfer';

-- Each transfer_group_id has exactly one 'in' and one 'out'
CREATE UNIQUE INDEX IF NOT EXISTS uq_operations_transfer_group_direction
  ON public.operations(transfer_group_id, transfer_direction) WHERE type = 'transfer';

-- Backfill: assign all existing operations to default account
UPDATE public.operations o
SET account_id = a.id
FROM public.accounts a
WHERE a.workspace_id = o.workspace_id AND a.is_default = true AND o.account_id IS NULL;

-- Now make account_id NOT NULL
ALTER TABLE public.operations ALTER COLUMN account_id SET NOT NULL;

-- ==================
-- RPC: create_transfer
-- ==================
CREATE OR REPLACE FUNCTION public.create_transfer(
  p_workspace_id uuid,
  p_user_id uuid,
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount numeric,
  p_description text DEFAULT NULL,
  p_operation_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (transfer_group_id uuid, out_operation_id uuid, in_operation_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_group_id uuid := gen_random_uuid();
  v_out_id uuid;
  v_in_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Сумма должна быть > 0'; END IF;
  IF p_from_account_id = p_to_account_id THEN RAISE EXCEPTION 'Счета должны отличаться'; END IF;

  PERFORM 1 FROM public.accounts WHERE id = p_from_account_id AND workspace_id = p_workspace_id AND NOT is_archived;
  IF NOT FOUND THEN RAISE EXCEPTION 'Счёт списания недоступен'; END IF;
  PERFORM 1 FROM public.accounts WHERE id = p_to_account_id AND workspace_id = p_workspace_id AND NOT is_archived;
  IF NOT FOUND THEN RAISE EXCEPTION 'Счёт зачисления недоступен'; END IF;

  INSERT INTO public.operations (workspace_id, user_id, amount, type, description, operation_date, account_id, transfer_group_id, transfer_direction)
  VALUES (p_workspace_id, p_user_id, p_amount, 'transfer', p_description, COALESCE(p_operation_date, CURRENT_DATE), p_from_account_id, v_group_id, 'out')
  RETURNING id INTO v_out_id;

  INSERT INTO public.operations (workspace_id, user_id, amount, type, description, operation_date, account_id, transfer_group_id, transfer_direction)
  VALUES (p_workspace_id, p_user_id, p_amount, 'transfer', p_description, COALESCE(p_operation_date, CURRENT_DATE), p_to_account_id, v_group_id, 'in')
  RETURNING id INTO v_in_id;

  UPDATE public.operations SET linked_operation_id = v_in_id WHERE id = v_out_id;
  UPDATE public.operations SET linked_operation_id = v_out_id WHERE id = v_in_id;

  RETURN QUERY SELECT v_group_id, v_out_id, v_in_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.create_transfer(uuid, uuid, uuid, uuid, numeric, text, date) TO authenticated;

-- ==================
-- RPC: update_transfer
-- ==================
CREATE OR REPLACE FUNCTION public.update_transfer(
  p_workspace_id uuid,
  p_transfer_group_id uuid,
  p_from_account_id uuid DEFAULT NULL,
  p_to_account_id uuid DEFAULT NULL,
  p_amount numeric DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_operation_date date DEFAULT NULL
)
RETURNS TABLE (out_operation_id uuid, in_operation_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_out_id uuid;
  v_in_id uuid;
BEGIN
  SELECT id INTO v_out_id FROM public.operations
    WHERE workspace_id = p_workspace_id AND transfer_group_id = p_transfer_group_id
      AND type = 'transfer' AND transfer_direction = 'out' FOR UPDATE;
  SELECT id INTO v_in_id FROM public.operations
    WHERE workspace_id = p_workspace_id AND transfer_group_id = p_transfer_group_id
      AND type = 'transfer' AND transfer_direction = 'in' FOR UPDATE;

  IF v_out_id IS NULL OR v_in_id IS NULL THEN
    RAISE EXCEPTION 'Перевод не найден: %', p_transfer_group_id;
  END IF;

  IF p_from_account_id IS NOT NULL AND p_to_account_id IS NOT NULL AND p_from_account_id = p_to_account_id THEN
    RAISE EXCEPTION 'Счета должны отличаться';
  END IF;

  UPDATE public.operations SET
    account_id = COALESCE(p_from_account_id, account_id),
    amount = COALESCE(p_amount, amount),
    description = COALESCE(p_description, description),
    operation_date = COALESCE(p_operation_date, operation_date)
  WHERE id = v_out_id;

  UPDATE public.operations SET
    account_id = COALESCE(p_to_account_id, account_id),
    amount = COALESCE(p_amount, amount),
    description = COALESCE(p_description, description),
    operation_date = COALESCE(p_operation_date, operation_date)
  WHERE id = v_in_id;

  RETURN QUERY SELECT v_out_id, v_in_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.update_transfer(uuid, uuid, uuid, uuid, numeric, text, date) TO authenticated;

-- ==================
-- RPC: get_account_balances
-- ==================
CREATE OR REPLACE FUNCTION public.get_account_balances(p_workspace_id uuid)
RETURNS TABLE (account_id uuid, balance numeric)
LANGUAGE sql STABLE AS $$
  SELECT o.account_id,
    COALESCE(SUM(CASE
      WHEN o.type IN ('income', 'salary') THEN o.amount
      WHEN o.type = 'transfer' AND o.transfer_direction = 'in' THEN o.amount
      ELSE -o.amount
    END), 0)::numeric AS balance
  FROM public.operations o
  WHERE o.workspace_id = p_workspace_id
  GROUP BY o.account_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_account_balances(uuid) TO authenticated;

COMMIT;
