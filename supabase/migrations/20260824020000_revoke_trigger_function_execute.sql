-- These functions are invoked only by database triggers. Production retained
-- explicit authenticated/service_role EXECUTE grants that are absent from a
-- clean local schema and are not part of the application RPC contract.

BEGIN;

REVOKE ALL ON FUNCTION public.create_user_profile()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.protect_operation_reconciliation()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
