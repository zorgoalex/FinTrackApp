-- Require a recently verified TOTP factor for destructive or privilege-changing
-- operations. The JWT is verified by Supabase before auth.jwt() exposes it.

BEGIN;

CREATE OR REPLACE FUNCTION public.current_user_requires_workspace_mfa()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members member
    WHERE member.user_id = auth.uid()
      AND member.is_active
      AND member.role IN ('Owner'::public.workspace_role, 'Admin'::public.workspace_role)
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_requires_workspace_mfa()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_requires_workspace_mfa()
  TO authenticated;

CREATE OR REPLACE FUNCTION public.current_user_meets_workspace_mfa(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members member
    WHERE member.workspace_id = p_workspace_id
      AND member.user_id = auth.uid()
      AND member.is_active
      AND (
        -- Supabase-issued end-user JWTs always carry role=authenticated.
        -- The fallback keeps database maintenance and legacy pgTAP fixtures usable.
        COALESCE(auth.jwt() ->> 'role', '') <> 'authenticated'
        OR member.role NOT IN ('Owner'::public.workspace_role, 'Admin'::public.workspace_role)
        OR (
          COALESCE(auth.jwt() ->> 'aal', '') = 'aal2'
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(auth.jwt() -> 'amr', '[]'::jsonb)) AS method
            WHERE method ->> 'method' = 'mfa/totp'
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_meets_workspace_mfa(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_meets_workspace_mfa(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_session_has_fresh_totp_aal2()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(auth.jwt() ->> 'aal', '') = 'aal2'
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(auth.jwt() -> 'amr', '[]'::jsonb)) AS method
      WHERE method ->> 'method' = 'mfa/totp'
        AND COALESCE(method ->> 'timestamp', '') ~ '^[0-9]+$'
        AND (method ->> 'timestamp')::bigint
          >= extract(epoch FROM clock_timestamp() - interval '10 minutes')::bigint
    );
$$;

REVOKE ALL ON FUNCTION public.current_session_has_fresh_totp_aal2()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_session_has_fresh_totp_aal2()
  TO authenticated, service_role;

-- Preserve the password/session step-up wrapper installed by stage 0 behind
-- a second wrapper. Account deletion now needs both a fresh password and TOTP.
ALTER FUNCTION public.delete_my_account(text)
  RENAME TO delete_my_account_password_internal;
REVOKE ALL ON FUNCTION public.delete_my_account_password_internal(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.delete_my_account(p_confirmation_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация';
  END IF;
  IF NOT public.current_session_has_fresh_totp_aal2() THEN
    RAISE EXCEPTION 'Подтвердите действие свежим кодом TOTP';
  END IF;

  PERFORM public.delete_my_account_password_internal(p_confirmation_email);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_my_account(text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_my_account(text) TO authenticated;

-- The existing restore implementation keeps all allowlists, role checks and
-- transaction guarantees. Only the AAL2 wrapper remains exposed to users.
ALTER FUNCTION public.restore_workspace_backup(uuid, jsonb, boolean)
  RENAME TO restore_workspace_backup_aal1_internal;
REVOKE ALL ON FUNCTION public.restore_workspace_backup_aal1_internal(uuid, jsonb, boolean)
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
     AND NOT public.current_session_has_fresh_totp_aal2() THEN
    RAISE EXCEPTION 'Подтвердите восстановление свежим кодом TOTP';
  END IF;

  RETURN public.restore_workspace_backup_aal1_internal(p_workspace_id, p_backup, p_dry_run);
END;
$$;

REVOKE ALL ON FUNCTION public.restore_workspace_backup(uuid, jsonb, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_workspace_backup(uuid, jsonb, boolean)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.require_aal2_for_workspace_role_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     AND auth.uid() IS NOT NULL
     AND COALESCE(auth.role(), 'authenticated') <> 'service_role'
     AND NOT public.current_session_has_fresh_totp_aal2() THEN
    RAISE EXCEPTION 'Подтвердите изменение роли свежим кодом TOTP';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.require_aal2_for_workspace_role_change()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS require_aal2_for_workspace_role_change
  ON public.workspace_members;
CREATE TRIGGER require_aal2_for_workspace_role_change
  BEFORE UPDATE OF role ON public.workspace_members
  FOR EACH ROW
  EXECUTE FUNCTION public.require_aal2_for_workspace_role_change();

-- A password-only Owner/Admin token must not be able to bypass the frontend
-- and read or mutate workspace data through PostgREST. Add one restrictive
-- policy to every RLS table that carries a workspace_id column.
DO $$
DECLARE
  target regclass;
BEGIN
  FOR target IN
    SELECT format('%I.%I', namespace.nspname, relation.relname)::regclass
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND relation.relrowsecurity
      AND attribute.attname = 'workspace_id'
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS privileged_workspace_mfa ON %s', target);
    EXECUTE format(
      'CREATE POLICY privileged_workspace_mfa ON %s AS RESTRICTIVE FOR ALL TO authenticated USING (public.current_user_meets_workspace_mfa(workspace_id)) WITH CHECK (public.current_user_meets_workspace_mfa(workspace_id))',
      target
    );
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS privileged_workspace_mfa ON public.workspaces;
CREATE POLICY privileged_workspace_mfa ON public.workspaces
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_meets_workspace_mfa(id))
  WITH CHECK (public.current_user_meets_workspace_mfa(id));

DROP POLICY IF EXISTS privileged_workspace_mfa ON public.operation_split_groups;
CREATE POLICY privileged_workspace_mfa ON public.operation_split_groups
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_meets_workspace_mfa(source_workspace_id))
  WITH CHECK (public.current_user_meets_workspace_mfa(source_workspace_id));

COMMIT;
