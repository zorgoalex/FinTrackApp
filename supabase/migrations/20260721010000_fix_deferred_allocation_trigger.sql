-- Fix deferred allocation validation for regular operation inserts.
--
-- The trigger is shared by operations and operation_allocations. Referencing
-- NEW.id and NEW.operation_id in one SQL CASE expression makes PostgreSQL
-- resolve both fields for the current trigger record. An operations record has
-- no operation_id field, so otherwise-valid imports fail when the deferred
-- trigger runs at transaction commit.

BEGIN;

CREATE OR REPLACE FUNCTION public.validate_operation_allocation_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operation_id uuid;
  v_operation public.operations;
  v_count integer;
  v_amount numeric;
  v_base_amount numeric;
BEGIN
  IF TG_TABLE_NAME = 'operations' THEN
    IF TG_OP = 'DELETE' THEN
      v_operation_id := OLD.id;
    ELSE
      v_operation_id := NEW.id;
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      v_operation_id := OLD.operation_id;
    ELSE
      v_operation_id := NEW.operation_id;
    END IF;
  END IF;

  SELECT * INTO v_operation
  FROM public.operations
  WHERE id = v_operation_id;

  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  SELECT count(*), COALESCE(sum(amount), 0), COALESCE(sum(base_amount), 0)
  INTO v_count, v_amount, v_base_amount
  FROM public.operation_allocations
  WHERE operation_id = v_operation_id;

  IF v_count > 0
     AND (v_amount <> v_operation.amount OR v_base_amount <> v_operation.base_amount) THEN
    RAISE EXCEPTION 'Сумма распределений должна совпадать с суммой операции';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.validate_operation_allocation_totals() IS
  'Validates deferred allocation totals for operations and operation_allocations without cross-table NEW field access.';

COMMIT;
