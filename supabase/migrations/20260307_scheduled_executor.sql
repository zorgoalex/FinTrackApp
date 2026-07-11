-- Turn scheduled operation templates into real, idempotent operations.

ALTER TABLE public.scheduled_operations
  ADD COLUMN IF NOT EXISTS account_id uuid,
  ADD COLUMN IF NOT EXISTS anchor_month smallint,
  ADD COLUMN IF NOT EXISTS anchor_day smallint,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS last_error_at timestamptz;

UPDATE public.scheduled_operations s
SET account_id = a.id
FROM public.accounts a
WHERE s.account_id IS NULL
  AND a.workspace_id = s.workspace_id
  AND a.is_default
  AND NOT a.is_archived;

UPDATE public.scheduled_operations
SET anchor_month = EXTRACT(MONTH FROM next_date)::smallint,
    anchor_day = EXTRACT(DAY FROM next_date)::smallint
WHERE anchor_month IS NULL OR anchor_day IS NULL;

ALTER TABLE public.scheduled_operations
  DROP CONSTRAINT IF EXISTS scheduled_operations_account_workspace_fkey;
ALTER TABLE public.scheduled_operations
  ADD CONSTRAINT scheduled_operations_account_workspace_fkey
  FOREIGN KEY (account_id, workspace_id)
  REFERENCES public.accounts(id, workspace_id)
  ON DELETE RESTRICT;

ALTER TABLE public.scheduled_operations
  DROP CONSTRAINT IF EXISTS scheduled_operations_anchor_month_check;
ALTER TABLE public.scheduled_operations
  ADD CONSTRAINT scheduled_operations_anchor_month_check
  CHECK (anchor_month BETWEEN 1 AND 12);
ALTER TABLE public.scheduled_operations
  DROP CONSTRAINT IF EXISTS scheduled_operations_anchor_day_check;
ALTER TABLE public.scheduled_operations
  ADD CONSTRAINT scheduled_operations_anchor_day_check
  CHECK (anchor_day BETWEEN 1 AND 31);

ALTER TABLE public.operations
  ADD COLUMN IF NOT EXISTS scheduled_operation_id uuid
    REFERENCES public.scheduled_operations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scheduled_for_date date;

CREATE UNIQUE INDEX IF NOT EXISTS operations_scheduled_occurrence_unique
  ON public.operations (scheduled_operation_id, scheduled_for_date)
  WHERE scheduled_operation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS operations_scheduled_operation_idx
  ON public.operations (scheduled_operation_id, operation_date DESC)
  WHERE scheduled_operation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.next_scheduled_date(
  p_current_date date,
  p_frequency text,
  p_anchor_month smallint,
  p_anchor_day smallint
)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_target_month date;
  v_last_day integer;
BEGIN
  CASE p_frequency
    WHEN 'daily' THEN RETURN p_current_date + 1;
    WHEN 'weekly' THEN RETURN p_current_date + 7;
    WHEN 'monthly' THEN
      v_target_month := (date_trunc('month', p_current_date) + interval '1 month')::date;
      v_last_day := EXTRACT(DAY FROM (v_target_month + interval '1 month - 1 day'))::integer;
      RETURN make_date(
        EXTRACT(YEAR FROM v_target_month)::integer,
        EXTRACT(MONTH FROM v_target_month)::integer,
        LEAST(COALESCE(p_anchor_day, EXTRACT(DAY FROM p_current_date)::smallint), v_last_day)
      );
    WHEN 'yearly' THEN
      v_target_month := make_date(
        EXTRACT(YEAR FROM p_current_date)::integer + 1,
        COALESCE(p_anchor_month, EXTRACT(MONTH FROM p_current_date)::smallint),
        1
      );
      v_last_day := EXTRACT(DAY FROM (v_target_month + interval '1 month - 1 day'))::integer;
      RETURN make_date(
        EXTRACT(YEAR FROM v_target_month)::integer,
        EXTRACT(MONTH FROM v_target_month)::integer,
        LEAST(COALESCE(p_anchor_day, EXTRACT(DAY FROM p_current_date)::smallint), v_last_day)
      );
    ELSE
      RAISE EXCEPTION 'Неподдерживаемая частота: %', p_frequency;
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_scheduled_operations(p_limit integer DEFAULT 100)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schedule public.scheduled_operations%ROWTYPE;
  v_due_date date;
  v_account_currency text;
  v_base_currency text;
  v_rate numeric;
  v_operation_id uuid;
  v_processed integer := 0;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'p_limit должен быть от 1 до 1000';
  END IF;

  FOR v_schedule IN
    SELECT *
    FROM public.scheduled_operations
    WHERE is_active AND next_date <= CURRENT_DATE
    ORDER BY next_date, id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  LOOP
    BEGIN
      v_due_date := v_schedule.next_date;

      IF NOT public.user_has_role(
        v_schedule.user_id,
        v_schedule.workspace_id,
        ARRAY['Owner', 'Admin', 'Member']
      ) THEN
        UPDATE public.scheduled_operations
        SET is_active = false,
            last_error = 'Создатель расписания больше не может добавлять операции',
            last_error_at = now()
        WHERE id = v_schedule.id;
        CONTINUE;
      END IF;

      SELECT a.currency, w.base_currency
      INTO v_account_currency, v_base_currency
      FROM public.accounts a
      JOIN public.workspaces w ON w.id = a.workspace_id
      WHERE a.id = v_schedule.account_id
        AND a.workspace_id = v_schedule.workspace_id
        AND NOT a.is_archived;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Выберите активный счёт для расписания';
      END IF;

      IF v_account_currency = v_base_currency THEN
        v_rate := 1;
      ELSE
        v_rate := public.get_exchange_rate(
          v_schedule.workspace_id,
          v_account_currency,
          v_base_currency,
          v_due_date
        );
        IF v_rate IS NULL THEN
          RAISE EXCEPTION 'Нет курса % → % на %', v_account_currency, v_base_currency, v_due_date;
        END IF;
      END IF;

      INSERT INTO public.operations (
        workspace_id, user_id, amount, type, description, operation_date,
        category_id, account_id, currency, exchange_rate, base_amount,
        scheduled_operation_id, scheduled_for_date
      ) VALUES (
        v_schedule.workspace_id, v_schedule.user_id, v_schedule.amount,
        v_schedule.type, v_schedule.description, v_due_date,
        v_schedule.category_id, v_schedule.account_id, v_account_currency,
        v_rate, round(v_schedule.amount * v_rate, 2),
        v_schedule.id, v_due_date
      )
      ON CONFLICT (scheduled_operation_id, scheduled_for_date)
        WHERE scheduled_operation_id IS NOT NULL
      DO NOTHING
      RETURNING id INTO v_operation_id;

      UPDATE public.scheduled_operations
      SET next_date = public.next_scheduled_date(
            v_due_date, frequency, anchor_month, anchor_day
          ),
          currency = v_account_currency,
          last_error = NULL,
          last_error_at = NULL
      WHERE id = v_schedule.id;

      v_processed := v_processed + CASE WHEN v_operation_id IS NULL THEN 0 ELSE 1 END;
      v_operation_id := NULL;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.scheduled_operations
      SET last_error = SQLERRM, last_error_at = now()
      WHERE id = v_schedule.id;
    END;
  END LOOP;

  RETURN v_processed;
END;
$$;

REVOKE ALL ON FUNCTION public.next_scheduled_date(date, text, smallint, smallint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_scheduled_operations(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_scheduled_operations(integer) TO service_role;

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
EXCEPTION
  WHEN insufficient_privilege OR feature_not_supported THEN
    RAISE NOTICE 'pg_cron must be enabled from Supabase Integrations';
END;
$$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'fintrack-process-scheduled-operations',
    '5 * * * *',
    'select public.process_scheduled_operations(100);'
  );
EXCEPTION
  WHEN invalid_schema_name OR undefined_function OR insufficient_privilege THEN
    RAISE NOTICE 'Cron job was not created; enable Supabase Cron and schedule process_scheduled_operations';
END;
$$;
