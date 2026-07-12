-- Account opening balances and a server-side, FX-aware balance history RPC.

BEGIN;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS opening_balance numeric(15,2),
  ADD COLUMN IF NOT EXISTS opening_date date;

-- Existing accounts did not have a declared opening balance. Treat their
-- creation date as the zero-balance starting point, without changing totals.
UPDATE public.accounts
SET opening_balance = COALESCE(opening_balance, 0),
    opening_date = COALESCE(opening_date, created_at::date)
WHERE opening_balance IS NULL OR opening_date IS NULL;

ALTER TABLE public.accounts
  ALTER COLUMN opening_balance SET DEFAULT 0,
  ALTER COLUMN opening_balance SET NOT NULL,
  ALTER COLUMN opening_date SET DEFAULT CURRENT_DATE,
  ALTER COLUMN opening_date SET NOT NULL;

CREATE OR REPLACE FUNCTION public.get_account_balance_history(
  p_workspace_id uuid,
  p_date_from date,
  p_date_to date,
  p_granularity text DEFAULT 'day',
  p_account_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  period_start date,
  period_end date,
  account_id uuid,
  account_name text,
  currency text,
  base_currency text,
  opening_balance numeric,
  change numeric,
  closing_balance numeric,
  opening_base_balance numeric,
  base_change numeric,
  closing_base_balance numeric
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_granularity text := lower(COALESCE(p_granularity, 'day'));
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Рабочее пространство не указано';
  END IF;
  IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_from > p_date_to THEN
    RAISE EXCEPTION 'Некорректный диапазон дат';
  END IF;
  IF v_granularity NOT IN ('day', 'week', 'month') THEN
    RAISE EXCEPTION 'Допустимая детализация: day, week или month';
  END IF;
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND (auth.uid() IS NULL OR NOT public.is_workspace_member(auth.uid(), p_workspace_id)) THEN
    RAISE EXCEPTION 'Нет доступа к рабочему пространству';
  END IF;
  IF p_account_ids IS NOT NULL AND EXISTS (
    SELECT 1
    FROM unnest(p_account_ids) AS requested(requested_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.accounts account
      WHERE account.id = requested_id AND account.workspace_id = p_workspace_id
    )
  ) THEN
    RAISE EXCEPTION 'Один или несколько счетов не принадлежат рабочему пространству';
  END IF;

  RETURN QUERY
  WITH workspace_data AS (
    SELECT workspace.base_currency
    FROM public.workspaces workspace
    WHERE workspace.id = p_workspace_id
  ),
  selected_accounts AS (
    SELECT
      account.id,
      account.name,
      account.currency,
      workspace_data.base_currency,
      account.opening_balance,
      account.opening_date,
      CASE
        WHEN account.opening_balance = 0 THEN 0::numeric
        WHEN account.currency = workspace_data.base_currency THEN account.opening_balance::numeric
        ELSE account.opening_balance * public.get_exchange_rate(
          p_workspace_id, account.currency, workspace_data.base_currency, account.opening_date
        )
      END AS opening_base_amount
    FROM public.accounts account
    CROSS JOIN workspace_data
    WHERE account.workspace_id = p_workspace_id
      AND (
        (p_account_ids IS NULL AND NOT account.is_archived)
        OR account.id = ANY(COALESCE(p_account_ids, '{}'::uuid[]))
      )
  ),
  bucket_seed AS (
    SELECT CASE v_granularity
      WHEN 'week' THEN date_trunc('week', p_date_from)::date
      WHEN 'month' THEN date_trunc('month', p_date_from)::date
      ELSE p_date_from
    END AS first_bucket
  ),
  buckets AS (
    SELECT
      GREATEST(series.bucket_start::date, p_date_from) AS bucket_start,
      LEAST(
        CASE v_granularity
          WHEN 'week' THEN (series.bucket_start + interval '1 week - 1 day')::date
          WHEN 'month' THEN (series.bucket_start + interval '1 month - 1 day')::date
          ELSE series.bucket_start::date
        END,
        p_date_to
      ) AS bucket_end
    FROM bucket_seed
    CROSS JOIN LATERAL generate_series(
      bucket_seed.first_bucket::timestamp,
      p_date_to::timestamp,
      CASE v_granularity
        WHEN 'week' THEN interval '1 week'
        WHEN 'month' THEN interval '1 month'
        ELSE interval '1 day'
      END
    ) series(bucket_start)
  ),
  signed_operations AS (
    SELECT
      operation.account_id,
      operation.operation_date,
      CASE
        WHEN operation.type IN ('income', 'personal_salary')
          OR (operation.type = 'transfer' AND operation.transfer_direction = 'in')
          THEN operation.amount
        WHEN operation.type IN ('expense', 'employee_salary')
          OR (operation.type = 'transfer' AND operation.transfer_direction = 'out')
          THEN -operation.amount
        ELSE 0::numeric
      END AS native_change,
      CASE
        WHEN operation.type IN ('income', 'personal_salary')
          OR (operation.type = 'transfer' AND operation.transfer_direction = 'in')
          THEN operation.base_amount
        WHEN operation.type IN ('expense', 'employee_salary')
          OR (operation.type = 'transfer' AND operation.transfer_direction = 'out')
          THEN -operation.base_amount
        ELSE 0::numeric
      END AS base_change
    FROM public.operations operation
    JOIN selected_accounts account ON account.id = operation.account_id
    WHERE operation.workspace_id = p_workspace_id
      AND operation.operation_date >= account.opening_date
      AND operation.operation_date <= p_date_to
  ),
  initial_values AS (
    SELECT
      account.id AS account_id,
      CASE WHEN account.opening_date <= p_date_from
        THEN account.opening_balance ELSE 0::numeric END
        + COALESCE(SUM(operation.native_change) FILTER (
            WHERE operation.operation_date < p_date_from
          ), 0)::numeric AS initial_native,
      CASE WHEN account.opening_date <= p_date_from
        THEN account.opening_base_amount ELSE 0::numeric END
        + COALESCE(SUM(operation.base_change) FILTER (
            WHERE operation.operation_date < p_date_from
          ), 0)::numeric AS initial_base
    FROM selected_accounts account
    LEFT JOIN signed_operations operation ON operation.account_id = account.id
    GROUP BY account.id, account.opening_date, account.opening_balance, account.opening_base_amount
  ),
  bucket_changes AS (
    SELECT
      bucket.bucket_start,
      bucket.bucket_end,
      account.id AS account_id,
      (CASE WHEN account.opening_date > p_date_from
                  AND account.opening_date BETWEEN bucket.bucket_start AND bucket.bucket_end
        THEN account.opening_balance ELSE 0::numeric END
        + COALESCE(SUM(operation.native_change), 0)::numeric) AS native_change,
      (CASE WHEN account.opening_date > p_date_from
                  AND account.opening_date BETWEEN bucket.bucket_start AND bucket.bucket_end
        THEN account.opening_base_amount ELSE 0::numeric END
        + COALESCE(SUM(operation.base_change), 0)::numeric) AS base_delta
    FROM buckets bucket
    CROSS JOIN selected_accounts account
    LEFT JOIN signed_operations operation
      ON operation.account_id = account.id
     AND operation.operation_date BETWEEN bucket.bucket_start AND bucket.bucket_end
    GROUP BY bucket.bucket_start, bucket.bucket_end, account.id,
      account.opening_date, account.opening_balance, account.opening_base_amount
  ),
  history AS (
    SELECT
      bucket_change.*,
      initial_value.initial_native
        + COALESCE(SUM(bucket_change.native_change) OVER (
            PARTITION BY bucket_change.account_id ORDER BY bucket_change.bucket_start
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0) AS native_opening,
      initial_value.initial_base
        + COALESCE(SUM(bucket_change.base_delta) OVER (
            PARTITION BY bucket_change.account_id ORDER BY bucket_change.bucket_start
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0) AS base_opening
    FROM bucket_changes bucket_change
    JOIN initial_values initial_value ON initial_value.account_id = bucket_change.account_id
  )
  SELECT
    history.bucket_start,
    history.bucket_end,
    account.id,
    account.name,
    account.currency,
    account.base_currency,
    history.native_opening,
    history.native_change,
    history.native_opening + history.native_change,
    history.base_opening,
    history.base_delta,
    history.base_opening + history.base_delta
  FROM history
  JOIN selected_accounts account ON account.id = history.account_id
  ORDER BY history.bucket_start, account.name, account.id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_account_balance_history(uuid, date, date, text, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_account_balance_history(uuid, date, date, text, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_account_balance_history(uuid, date, date, text, uuid[])
  TO authenticated, service_role;

COMMIT;
