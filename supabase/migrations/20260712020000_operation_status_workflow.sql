-- Review and reconciliation state machine for financial operations.

BEGIN;

ALTER TABLE public.operations
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.operations
SET status = CASE WHEN import_session_id IS NULL THEN 'verified' ELSE 'new' END,
    verified_at = CASE WHEN import_session_id IS NULL THEN COALESCE(updated_at, created_at) ELSE NULL END,
    verified_by = CASE WHEN import_session_id IS NULL THEN user_id ELSE NULL END
WHERE status IS NULL;

ALTER TABLE public.operations ALTER COLUMN status SET DEFAULT 'verified';
ALTER TABLE public.operations ALTER COLUMN status SET NOT NULL;
ALTER TABLE public.operations DROP CONSTRAINT IF EXISTS operations_status_check;
ALTER TABLE public.operations ADD CONSTRAINT operations_status_check
  CHECK (status IN ('new', 'verified', 'reconciled'));
ALTER TABLE public.operations DROP CONSTRAINT IF EXISTS operations_status_metadata_check;
ALTER TABLE public.operations ADD CONSTRAINT operations_status_metadata_check CHECK (
  (status = 'new' AND verified_at IS NULL AND verified_by IS NULL AND reconciled_at IS NULL AND reconciled_by IS NULL)
  OR (status = 'verified' AND verified_at IS NOT NULL AND reconciled_at IS NULL AND reconciled_by IS NULL)
  OR (status = 'reconciled' AND verified_at IS NOT NULL AND reconciled_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS operations_workspace_status_date_idx
  ON public.operations(workspace_id, status, operation_date DESC);

CREATE OR REPLACE FUNCTION public.prepare_operation_status_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'new' THEN
    NEW.verified_at := NULL;
    NEW.verified_by := NULL;
    NEW.reconciled_at := NULL;
    NEW.reconciled_by := NULL;
  ELSIF NEW.status = 'verified' THEN
    NEW.verified_at := COALESCE(NEW.verified_at, now());
    NEW.verified_by := COALESCE(NEW.verified_by, auth.uid(), NEW.user_id);
    NEW.reconciled_at := NULL;
    NEW.reconciled_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prepare_operation_status_on_insert ON public.operations;
CREATE TRIGGER prepare_operation_status_on_insert
  BEFORE INSERT ON public.operations
  FOR EACH ROW
  EXECUTE FUNCTION public.prepare_operation_status_on_insert();

CREATE TABLE IF NOT EXISTS public.operation_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL REFERENCES public.operations(id) ON DELETE CASCADE,
  from_status text CHECK (from_status IS NULL OR from_status IN ('new', 'verified', 'reconciled')),
  to_status text NOT NULL CHECK (to_status IN ('new', 'verified', 'reconciled')),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 3 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operation_status_events_operation_created_idx
  ON public.operation_status_events(operation_id, created_at, id);

INSERT INTO public.operation_status_events (
  workspace_id, operation_id, from_status, to_status, actor_id, reason, created_at
)
SELECT
  operation.workspace_id,
  operation.id,
  NULL,
  operation.status,
  CASE WHEN operation.status = 'verified' THEN operation.user_id ELSE NULL END,
  'Первичное состояние при миграции',
  operation.created_at
FROM public.operations operation
WHERE NOT EXISTS (
  SELECT 1 FROM public.operation_status_events event
  WHERE event.operation_id = operation.id
);

ALTER TABLE public.operation_status_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS operation_status_events_select ON public.operation_status_events;
CREATE POLICY operation_status_events_select ON public.operation_status_events FOR SELECT
  USING (public.is_workspace_member((SELECT auth.uid()), workspace_id));

REVOKE ALL ON public.operation_status_events FROM anon, authenticated;
GRANT SELECT ON public.operation_status_events TO authenticated;

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
      NEW.account_id, NEW.debt_id, NEW.debt_applied_amount, NEW.currency,
      NEW.exchange_rate, NEW.base_amount
    ) IS DISTINCT FROM ROW(
      OLD.amount, OLD.type, OLD.description, OLD.operation_date, OLD.category_id,
      OLD.account_id, OLD.debt_id, OLD.debt_applied_amount, OLD.currency,
      OLD.exchange_rate, OLD.base_amount
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

DROP TRIGGER IF EXISTS protect_operation_reconciliation ON public.operations;
CREATE TRIGGER protect_operation_reconciliation
  BEFORE UPDATE ON public.operations
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_operation_reconciliation();

CREATE OR REPLACE FUNCTION public.transition_operation_status(
  p_operation_id uuid,
  p_target_status text,
  p_reason text DEFAULT NULL
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
  v_from_status text;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация';
  END IF;
  IF p_target_status NOT IN ('new', 'verified', 'reconciled') THEN
    RAISE EXCEPTION 'Некорректный статус операции';
  END IF;

  SELECT * INTO v_operation
  FROM public.operations
  WHERE id = p_operation_id
  FOR UPDATE;

  IF NOT FOUND OR NOT public.is_workspace_member(v_actor, v_operation.workspace_id) THEN
    RAISE EXCEPTION 'Операция не найдена';
  END IF;

  v_role := public.get_user_role_in_workspace(v_operation.workspace_id, v_actor);
  IF v_operation.status = p_target_status THEN
    RETURN v_operation;
  END IF;

  v_from_status := v_operation.status;

  IF v_operation.status = 'new' AND p_target_status = 'verified' THEN
    IF v_role NOT IN ('Owner', 'Admin')
       AND NOT (v_role = 'Member' AND v_operation.user_id = v_actor) THEN
      RAISE EXCEPTION 'Недостаточно прав для подтверждения операции';
    END IF;
  ELSIF v_operation.status = 'verified' AND p_target_status = 'reconciled' THEN
    IF v_role NOT IN ('Owner', 'Admin') THEN
      RAISE EXCEPTION 'Только владелец или администратор может сверять операции';
    END IF;
  ELSIF v_operation.status IN ('verified', 'reconciled')
        AND p_target_status IN ('new', 'verified') THEN
    IF v_role NOT IN ('Owner', 'Admin') THEN
      RAISE EXCEPTION 'Только владелец или администратор может отменить статус';
    END IF;
    IF v_reason IS NULL OR char_length(v_reason) < 3 THEN
      RAISE EXCEPTION 'Укажите причину отмены статуса';
    END IF;
  ELSE
    RAISE EXCEPTION 'Переход статуса % → % запрещён', v_operation.status, p_target_status;
  END IF;

  PERFORM set_config('fintrack.status_transition', 'on', true);

  UPDATE public.operations
  SET status = p_target_status,
      verified_at = CASE
        WHEN p_target_status = 'new' THEN NULL
        WHEN v_operation.verified_at IS NULL THEN now()
        ELSE v_operation.verified_at
      END,
      verified_by = CASE
        WHEN p_target_status = 'new' THEN NULL
        WHEN v_operation.verified_at IS NULL THEN v_actor
        ELSE v_operation.verified_by
      END,
      reconciled_at = CASE WHEN p_target_status = 'reconciled' THEN now() ELSE NULL END,
      reconciled_by = CASE WHEN p_target_status = 'reconciled' THEN v_actor ELSE NULL END
  WHERE id = p_operation_id
  RETURNING * INTO v_operation;

  INSERT INTO public.operation_status_events (
    workspace_id, operation_id, from_status, to_status, actor_id, reason
  ) VALUES (
    v_operation.workspace_id, p_operation_id, v_from_status,
    p_target_status, v_actor, v_reason
  );

  RETURN v_operation;
END;
$$;

-- Recreate delete policy so reconciled records cannot be removed directly.
DROP POLICY IF EXISTS operations_delete_policy ON public.operations;
CREATE POLICY operations_delete_policy ON public.operations FOR DELETE
  USING (
    status <> 'reconciled'
    AND (
      public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin'])
      OR (
        public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Member'])
        AND user_id = (SELECT auth.uid())
      )
    )
  );

REVOKE ALL ON FUNCTION public.transition_operation_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_operation_status(uuid, text, text) TO authenticated;

COMMIT;
