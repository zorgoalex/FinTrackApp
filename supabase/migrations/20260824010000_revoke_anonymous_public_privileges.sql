-- The application has no anonymous Data API surface. Authentication flows use
-- Supabase Auth or dedicated Edge Functions, while application data requires an
-- authenticated JWT. Keep RLS as the row-level gate and remove the redundant
-- object privileges that could amplify a future policy mistake.

BEGIN;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;

-- Prevent later migrations from silently recreating anonymous access through
-- PostgreSQL defaults. Explicit authenticated/service_role grants remain the
-- only supported application access contract.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;

COMMIT;
