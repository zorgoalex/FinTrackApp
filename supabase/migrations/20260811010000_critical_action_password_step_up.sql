-- Require a recently authenticated password session for critical workspace
-- administration without forcing consumer users to enroll a TOTP factor.

BEGIN;

CREATE OR REPLACE FUNCTION public.current_session_has_fresh_password()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(auth.jwt() -> 'amr', '[]'::jsonb)) AS method
      WHERE method ->> 'method' = 'password'
        AND COALESCE(method ->> 'timestamp', '') ~ '^[0-9]+$'
        AND (method ->> 'timestamp')::bigint
          >= extract(epoch FROM clock_timestamp() - interval '5 minutes')::bigint
    )
    AND EXISTS (
      SELECT 1
      FROM auth.sessions session
      WHERE session.id = NULLIF(auth.jwt() ->> 'session_id', '')::uuid
        AND session.user_id = auth.uid()
    );
$$;

REVOKE ALL ON FUNCTION public.current_session_has_fresh_password()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_session_has_fresh_password()
  TO authenticated, service_role;

-- Preserve the transactional restore implementation behind a password
-- step-up wrapper. Service-role maintenance remains available.
ALTER FUNCTION public.restore_workspace_backup(uuid, jsonb, boolean)
  RENAME TO restore_workspace_backup_password_internal;
REVOKE ALL ON FUNCTION public.restore_workspace_backup_password_internal(uuid, jsonb, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.restore_workspace_backup(
  p_workspace_id uuid,
  p_backup jsonb,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.current_session_has_fresh_password() THEN
    RAISE EXCEPTION 'Повторно подтвердите текущий пароль';
  END IF;

  RETURN public.restore_workspace_backup_password_internal(p_workspace_id, p_backup, p_dry_run);
END;
$$;

REVOKE ALL ON FUNCTION public.restore_workspace_backup(uuid, jsonb, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_workspace_backup(uuid, jsonb, boolean)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.require_fresh_password_for_workspace_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_catalog
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     AND auth.uid() IS NOT NULL
     AND COALESCE(auth.role(), 'authenticated') <> 'service_role'
     AND NOT public.current_session_has_fresh_password() THEN
    RAISE EXCEPTION 'Повторно подтвердите текущий пароль';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.require_fresh_password_for_workspace_role_change()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS require_fresh_password_for_workspace_role_change
  ON public.workspace_members;
CREATE TRIGGER require_fresh_password_for_workspace_role_change
  BEFORE UPDATE OF role ON public.workspace_members
  FOR EACH ROW
  EXECUTE FUNCTION public.require_fresh_password_for_workspace_role_change();

COMMIT;
