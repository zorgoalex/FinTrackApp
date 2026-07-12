-- P1 counterparties and workspace-safe category/counterparty references.

BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_counterparty_name(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT lower(regexp_replace(btrim(p_value), '[[:space:]]+', ' ', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.normalize_counterparty_tax_id(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT NULLIF(upper(regexp_replace(COALESCE(p_value, ''), '[^[:alnum:]]', '', 'g')), '');
$$;

CREATE TABLE public.counterparties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'both' CHECK (kind IN ('customer', 'supplier', 'both')),
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 200),
  normalized_name text GENERATED ALWAYS AS
    (public.normalize_counterparty_name(display_name)) STORED,
  legal_name text CHECK (legal_name IS NULL OR char_length(btrim(legal_name)) BETWEEN 1 AND 300),
  tax_id text CHECK (tax_id IS NULL OR char_length(btrim(tax_id)) BETWEEN 1 AND 64),
  normalized_tax_id text GENERATED ALWAYS AS
    (public.normalize_counterparty_tax_id(tax_id)) STORED,
  registration_number text CHECK (
    registration_number IS NULL OR char_length(btrim(registration_number)) BETWEEN 1 AND 64
  ),
  email text CHECK (email IS NULL OR char_length(btrim(email)) BETWEEN 3 AND 320),
  phone text CHECK (phone IS NULL OR char_length(btrim(phone)) BETWEEN 3 AND 64),
  address text CHECK (address IS NULL OR char_length(btrim(address)) BETWEEN 1 AND 1000),
  contact_person text CHECK (
    contact_person IS NULL OR char_length(btrim(contact_person)) BETWEEN 1 AND 200
  ),
  default_currency text NOT NULL DEFAULT 'KZT' REFERENCES public.currencies(code),
  payment_term_days integer NOT NULL DEFAULT 0 CHECK (payment_term_days BETWEEN 0 AND 3650),
  bank_details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(bank_details) = 'object'),
  is_archived boolean NOT NULL DEFAULT false,
  merged_into_id uuid,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT counterparties_normalized_name_not_empty CHECK (normalized_name <> ''),
  CONSTRAINT counterparties_normalized_tax_id_format CHECK (
    normalized_tax_id IS NULL OR normalized_tax_id ~ '^[A-Z0-9]{4,32}$'
  ),
  CONSTRAINT counterparties_merge_state_check CHECK (
    merged_into_id IS NULL OR (is_archived AND merged_into_id <> id)
  ),
  CONSTRAINT counterparties_id_workspace_unique UNIQUE (id, workspace_id),
  CONSTRAINT counterparties_merged_into_workspace_fkey
    FOREIGN KEY (merged_into_id, workspace_id)
    REFERENCES public.counterparties(id, workspace_id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX counterparties_workspace_normalized_name_key
  ON public.counterparties(workspace_id, normalized_name);
CREATE UNIQUE INDEX counterparties_workspace_normalized_tax_id_key
  ON public.counterparties(workspace_id, normalized_tax_id)
  WHERE normalized_tax_id IS NOT NULL;
CREATE INDEX counterparties_workspace_active_name_idx
  ON public.counterparties(workspace_id, normalized_name)
  WHERE NOT is_archived;

CREATE TRIGGER update_counterparties_updated_at
  BEFORE UPDATE ON public.counterparties
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.protect_counterparty_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Системные реквизиты контрагента нельзя изменять';
  END IF;
  IF NEW.merged_into_id IS DISTINCT FROM OLD.merged_into_id
     AND current_setting('fintrack.counterparty_merge', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Объединение контрагентов выполняется только через merge_counterparties';
  END IF;
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by, OLD.updated_by);
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_counterparty_identity
  BEFORE UPDATE ON public.counterparties
  FOR EACH ROW EXECUTE FUNCTION public.protect_counterparty_identity();

ALTER TABLE public.counterparties ENABLE ROW LEVEL SECURITY;

CREATE POLICY counterparties_select ON public.counterparties FOR SELECT
  USING (public.is_workspace_member((SELECT auth.uid()), workspace_id));
CREATE POLICY counterparties_insert ON public.counterparties FOR INSERT
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND public.user_has_role(
      (SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin', 'Member']
    )
  );
CREATE POLICY counterparties_update ON public.counterparties FOR UPDATE
  USING (public.user_has_role(
    (SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin', 'Member']
  ))
  WITH CHECK (public.user_has_role(
    (SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin', 'Member']
  ));

GRANT SELECT, INSERT, UPDATE ON public.counterparties TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.counterparties TO service_role;

-- Backfill one counterparty per normalized legacy debt name. Mixed debt
-- directions become kind=both; the legacy text remains available to old clients.
INSERT INTO public.counterparties (
  workspace_id, kind, display_name, default_currency, created_by, updated_by, created_at, updated_at
)
SELECT
  d.workspace_id,
  CASE
    WHEN bool_or(d.direction = 'i_owe') AND bool_or(d.direction = 'owed_to_me') THEN 'both'
    WHEN bool_or(d.direction = 'i_owe') THEN 'supplier'
    ELSE 'customer'
  END,
  (array_agg(btrim(d.counterparty) ORDER BY d.created_at, d.id))[1],
  (array_agg(d.currency ORDER BY d.created_at, d.id))[1],
  (array_agg(d.created_by ORDER BY d.created_at, d.id))[1],
  (array_agg(d.created_by ORDER BY d.created_at DESC, d.id DESC))[1],
  min(d.created_at),
  max(d.updated_at)
FROM public.debts d
GROUP BY d.workspace_id, public.normalize_counterparty_name(d.counterparty)
ON CONFLICT (workspace_id, normalized_name) DO NOTHING;

-- Every compound FK needs a matching unique key on the referenced relation.
ALTER TABLE public.categories
  ADD CONSTRAINT categories_id_workspace_unique UNIQUE (id, workspace_id);

-- Repair any legacy cross-workspace category links before enforcing the
-- invariant. Keeping the operation/schedule is safer than deleting it.
UPDATE public.operations operation
SET category_id = NULL
WHERE operation.category_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.categories category
    WHERE category.id = operation.category_id
      AND category.workspace_id = operation.workspace_id
  );

UPDATE public.scheduled_operations schedule
SET category_id = NULL
WHERE schedule.category_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.categories category
    WHERE category.id = schedule.category_id
      AND category.workspace_id = schedule.workspace_id
  );

ALTER TABLE public.operations
  DROP CONSTRAINT IF EXISTS operations_category_id_fkey;
ALTER TABLE public.operations
  ADD CONSTRAINT operations_category_workspace_fkey
  FOREIGN KEY (category_id, workspace_id)
  REFERENCES public.categories(id, workspace_id)
  ON DELETE SET NULL (category_id);

ALTER TABLE public.scheduled_operations
  DROP CONSTRAINT IF EXISTS scheduled_operations_category_id_fkey;
ALTER TABLE public.scheduled_operations
  ADD CONSTRAINT scheduled_operations_category_workspace_fkey
  FOREIGN KEY (category_id, workspace_id)
  REFERENCES public.categories(id, workspace_id)
  ON DELETE SET NULL (category_id);

-- Upgrade the debt link itself from a global-id FK to a workspace-safe FK.
ALTER TABLE public.debts
  ADD CONSTRAINT debts_id_workspace_unique UNIQUE (id, workspace_id),
  ADD COLUMN counterparty_id uuid;

UPDATE public.debts debt
SET counterparty_id = counterparty.id
FROM public.counterparties counterparty
WHERE counterparty.workspace_id = debt.workspace_id
  AND counterparty.normalized_name = public.normalize_counterparty_name(debt.counterparty)
  AND debt.counterparty_id IS NULL;

ALTER TABLE public.debts
  ADD CONSTRAINT debts_counterparty_workspace_fkey
  FOREIGN KEY (counterparty_id, workspace_id)
  REFERENCES public.counterparties(id, workspace_id)
  ON DELETE RESTRICT;

DROP FUNCTION IF EXISTS public.get_debts_with_balance(uuid);
CREATE FUNCTION public.get_debts_with_balance(p_workspace_id uuid)
RETURNS TABLE (
  id uuid, workspace_id uuid, created_by uuid, title text, counterparty text,
  counterparty_id uuid, direction text, initial_amount numeric, paid_amount numeric,
  remaining_amount numeric, progress_pct numeric, opened_on date, due_on date,
  notes text, is_archived boolean, created_at timestamptz, updated_at timestamptz,
  currency text
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH paid AS (
    SELECT operation.debt_id,
      COALESCE(SUM(operation.debt_applied_amount), 0)::numeric AS paid_amount
    FROM public.operations operation
    WHERE operation.workspace_id = p_workspace_id AND operation.debt_id IS NOT NULL
    GROUP BY operation.debt_id
  )
  SELECT debt.id, debt.workspace_id, debt.created_by, debt.title, debt.counterparty,
    debt.counterparty_id, debt.direction, debt.initial_amount,
    COALESCE(paid.paid_amount, 0)::numeric AS paid_amount,
    GREATEST(debt.initial_amount - COALESCE(paid.paid_amount, 0), 0)::numeric AS remaining_amount,
    CASE WHEN debt.initial_amount = 0 THEN 100
      ELSE ROUND(LEAST(COALESCE(paid.paid_amount, 0) / debt.initial_amount, 1) * 100, 2)
    END::numeric AS progress_pct,
    debt.opened_on, debt.due_on, debt.notes, debt.is_archived,
    debt.created_at, debt.updated_at, debt.currency
  FROM public.debts debt
  LEFT JOIN paid ON paid.debt_id = debt.id
  WHERE debt.workspace_id = p_workspace_id
  ORDER BY debt.is_archived, remaining_amount DESC, debt.updated_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_debts_with_balance(uuid) TO authenticated;

ALTER TABLE public.operations
  DROP CONSTRAINT IF EXISTS operations_debt_id_fkey;
ALTER TABLE public.operations
  ADD CONSTRAINT operations_debt_workspace_fkey
  FOREIGN KEY (debt_id, workspace_id)
  REFERENCES public.debts(id, workspace_id)
  ON DELETE RESTRICT,
  ADD COLUMN counterparty_id uuid,
  ADD CONSTRAINT operations_counterparty_workspace_fkey
  FOREIGN KEY (counterparty_id, workspace_id)
  REFERENCES public.counterparties(id, workspace_id)
  ON DELETE RESTRICT;

CREATE INDEX operations_workspace_counterparty_date_idx
  ON public.operations(workspace_id, counterparty_id, operation_date DESC)
  WHERE counterparty_id IS NOT NULL;
CREATE INDEX debts_workspace_counterparty_idx
  ON public.debts(workspace_id, counterparty_id)
  WHERE counterparty_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_active_counterparty_reference()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.counterparty_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.counterparty_id IS NOT DISTINCT FROM OLD.counterparty_id
     AND NEW.workspace_id IS NOT DISTINCT FROM OLD.workspace_id THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.counterparties counterparty
    WHERE counterparty.id = NEW.counterparty_id
      AND counterparty.workspace_id = NEW.workspace_id
      AND NOT counterparty.is_archived
  ) THEN
    RAISE EXCEPTION 'Контрагент не найден или находится в архиве';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER operations_validate_active_counterparty
  BEFORE INSERT OR UPDATE OF counterparty_id, workspace_id ON public.operations
  FOR EACH ROW EXECUTE FUNCTION public.validate_active_counterparty_reference();
CREATE TRIGGER debts_validate_active_counterparty
  BEFORE INSERT OR UPDATE OF counterparty_id, workspace_id ON public.debts
  FOR EACH ROW EXECUTE FUNCTION public.validate_active_counterparty_reference();

-- A counterparty is a material classification field. Keep the status workflow
-- defined in the preceding migration intact, but include the new field in its
-- verified -> new demotion rule.
CREATE OR REPLACE FUNCTION public.protect_operation_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND current_setting('fintrack.status_transition', true) IS DISTINCT FROM 'on' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
       OR NEW.verified_by IS DISTINCT FROM OLD.verified_by
       OR NEW.reconciled_at IS DISTINCT FROM OLD.reconciled_at
       OR NEW.reconciled_by IS DISTINCT FROM OLD.reconciled_by THEN
      RAISE EXCEPTION 'Статус операции изменяется только через подтверждение или сверку';
    END IF;

    IF OLD.status = 'reconciled' AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'Сверенную операцию сначала необходимо вернуть на проверку';
    END IF;

    IF OLD.status = 'verified' AND ROW(
      NEW.amount, NEW.type, NEW.description, NEW.operation_date, NEW.category_id,
      NEW.counterparty_id, NEW.account_id, NEW.debt_id, NEW.debt_applied_amount,
      NEW.currency, NEW.exchange_rate, NEW.base_amount
    ) IS DISTINCT FROM ROW(
      OLD.amount, OLD.type, OLD.description, OLD.operation_date, OLD.category_id,
      OLD.counterparty_id, OLD.account_id, OLD.debt_id, OLD.debt_applied_amount,
      OLD.currency, OLD.exchange_rate, OLD.base_amount
    ) THEN
      NEW.status := 'new';
      NEW.verified_at := NULL;
      NEW.verified_by := NULL;
      NEW.reconciled_at := NULL;
      NEW.reconciled_by := NULL;
      INSERT INTO public.operation_status_events (
        workspace_id, operation_id, from_status, to_status, actor_id, reason
      ) VALUES (
        OLD.workspace_id, OLD.id, 'verified', 'new', auth.uid(),
        'Изменены финансовые реквизиты операции'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.merge_counterparties(
  p_source_id uuid,
  p_target_id uuid
)
RETURNS public.counterparties
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_source public.counterparties;
  v_target public.counterparties;
  v_previous_status_setting text;
  v_previous_merge_setting text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация';
  END IF;
  IF p_source_id IS NULL OR p_target_id IS NULL OR p_source_id = p_target_id THEN
    RAISE EXCEPTION 'Выберите двух разных контрагентов';
  END IF;

  -- Stable lock order prevents two opposite merge requests from deadlocking.
  PERFORM 1
  FROM public.counterparties
  WHERE id IN (p_source_id, p_target_id)
  ORDER BY id
  FOR UPDATE;

  SELECT * INTO v_source FROM public.counterparties WHERE id = p_source_id;
  SELECT * INTO v_target FROM public.counterparties WHERE id = p_target_id;
  IF v_source.id IS NULL OR v_target.id IS NULL
     OR v_source.workspace_id <> v_target.workspace_id THEN
    RAISE EXCEPTION 'Контрагенты не найдены в одном рабочем пространстве';
  END IF;
  IF NOT public.user_has_role(
    v_actor, v_source.workspace_id, ARRAY['Owner', 'Admin']
  ) THEN
    RAISE EXCEPTION 'Только владелец или администратор может объединять контрагентов';
  END IF;
  IF v_source.is_archived OR v_source.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION 'Исходный контрагент уже архивирован или объединён';
  END IF;
  IF v_target.is_archived OR v_target.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION 'Целевой контрагент должен быть активным';
  END IF;

  -- Reconciled operations are immutable to direct user writes. This narrowly
  -- scoped internal flag allows only this RPC's reference rewrite.
  v_previous_status_setting := current_setting('fintrack.status_transition', true);
  PERFORM set_config('fintrack.status_transition', 'on', true);
  UPDATE public.operations
  SET counterparty_id = p_target_id
  WHERE workspace_id = v_source.workspace_id
    AND counterparty_id = p_source_id;
  PERFORM set_config(
    'fintrack.status_transition', COALESCE(v_previous_status_setting, ''), true
  );

  UPDATE public.debts
  SET counterparty_id = p_target_id,
      counterparty = v_target.display_name
  WHERE workspace_id = v_source.workspace_id
    AND counterparty_id = p_source_id;

  v_previous_merge_setting := current_setting('fintrack.counterparty_merge', true);
  PERFORM set_config('fintrack.counterparty_merge', 'on', true);
  UPDATE public.counterparties
  SET is_archived = true,
      merged_into_id = p_target_id,
      updated_by = v_actor
  WHERE id = p_source_id;
  PERFORM set_config(
    'fintrack.counterparty_merge', COALESCE(v_previous_merge_setting, ''), true
  );

  SELECT * INTO v_target FROM public.counterparties WHERE id = p_target_id;
  RETURN v_target;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_counterparty_name(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.normalize_counterparty_tax_id(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_counterparty_name(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.normalize_counterparty_tax_id(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.protect_counterparty_identity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_active_counterparty_reference() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_counterparties(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_counterparties(uuid, uuid) TO authenticated;

COMMIT;
