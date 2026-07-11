-- Keep account balances aligned with dashboard, analytics, API and Telegram:
-- income increases an account; expense and salary decrease it; transfers are
-- represented by one outgoing and one incoming leg.

DROP FUNCTION IF EXISTS public.get_account_balances(uuid);
CREATE OR REPLACE FUNCTION public.get_account_balances(p_workspace_id uuid)
RETURNS TABLE (account_id uuid, currency text, balance numeric, base_balance numeric)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    a.id AS account_id,
    a.currency,
    COALESCE(SUM(CASE
      WHEN o.type = 'income' THEN o.amount
      WHEN o.type = 'transfer' AND o.transfer_direction = 'in' THEN o.amount
      WHEN o.type IN ('expense', 'salary')
        OR (o.type = 'transfer' AND o.transfer_direction = 'out') THEN -o.amount
      ELSE 0
    END), 0)::numeric AS balance,
    COALESCE(SUM(CASE
      WHEN o.type = 'income' THEN o.base_amount
      WHEN o.type = 'transfer' AND o.transfer_direction = 'in' THEN o.base_amount
      WHEN o.type IN ('expense', 'salary')
        OR (o.type = 'transfer' AND o.transfer_direction = 'out') THEN -o.base_amount
      ELSE 0
    END), 0)::numeric AS base_balance
  FROM public.accounts a
  LEFT JOIN public.operations o
    ON o.account_id = a.id
   AND o.workspace_id = p_workspace_id
  WHERE a.workspace_id = p_workspace_id
    AND NOT a.is_archived
  GROUP BY a.id, a.currency;
$$;

GRANT EXECUTE ON FUNCTION public.get_account_balances(uuid) TO authenticated;
