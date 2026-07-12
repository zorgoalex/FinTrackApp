-- Keep an account's declared opening balance in the opening column when the
-- account starts exactly on a returned bucket boundary. The original RPC
-- treated it as activity for accounts opened after p_date_from.
BEGIN;

ALTER FUNCTION public.get_account_balance_history(uuid, date, date, text, uuid[])
  RENAME TO get_account_balance_history_v1;

CREATE FUNCTION public.get_account_balance_history(
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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    history.period_start,
    history.period_end,
    history.account_id,
    history.account_name,
    history.currency,
    history.base_currency,
    history.opening_balance + adjustment.native_amount,
    history.change - adjustment.native_amount,
    history.closing_balance,
    history.opening_base_balance + adjustment.base_amount,
    history.base_change - adjustment.base_amount,
    history.closing_base_balance
  FROM public.get_account_balance_history_v1(
    p_workspace_id, p_date_from, p_date_to, p_granularity, p_account_ids
  ) history
  JOIN public.accounts account ON account.id = history.account_id
  CROSS JOIN LATERAL (
    SELECT
      CASE
        WHEN history.period_start = account.opening_date
             AND history.opening_balance = 0
          THEN account.opening_balance
        ELSE 0::numeric
      END AS native_amount,
      CASE
        WHEN history.period_start = account.opening_date
             AND history.opening_base_balance = 0
          THEN CASE
            WHEN account.currency = history.base_currency THEN account.opening_balance
            ELSE account.opening_balance * COALESCE(public.get_exchange_rate(
              p_workspace_id, account.currency, history.base_currency, account.opening_date
            ), 0)
          END
        ELSE 0::numeric
      END AS base_amount
  ) adjustment;
$$;

REVOKE ALL ON FUNCTION public.get_account_balance_history_v1(uuid, date, date, text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_account_balance_history_v1(uuid, date, date, text, uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.get_account_balance_history(uuid, date, date, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_account_balance_history(uuid, date, date, text, uuid[]) TO authenticated, service_role;

COMMIT;
