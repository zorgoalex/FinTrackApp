-- Allow signed-in users to reach the RLS-protected financial tables.
-- Table privileges are only the first gate: the existing RLS policies still
-- decide which workspace rows each user may read or mutate.

BEGIN;

REVOKE ALL ON TABLE
  public.accounts,
  public.operations,
  public.debts,
  public.currencies,
  public.exchange_rates,
  public.counterparties
FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE
    public.accounts,
    public.operations,
    public.debts,
    public.exchange_rates
  TO authenticated, service_role;

GRANT SELECT
  ON TABLE public.currencies
  TO authenticated, service_role;

-- The table intentionally has no authenticated DELETE policy. This privilege
-- lets PostgreSQL reach RLS, which then rejects physical deletion while the
-- merge_counterparties RPC remains the supported removal path.
GRANT DELETE
  ON TABLE public.counterparties
  TO authenticated;

COMMIT;
