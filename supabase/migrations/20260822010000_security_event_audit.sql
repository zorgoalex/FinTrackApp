-- Private, bounded security-event audit trail for the public beta.
-- Browser roles never receive schema/table access. Edge Functions write only
-- through a service-role RPC; authoritative database actions are logged by
-- SECURITY DEFINER wrappers and triggers.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE private.security_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_.-]{2,79}$'),
  outcome text NOT NULL CHECK (outcome IN ('success', 'failure', 'blocked')),
  actor_user_id uuid,
  target_user_id uuid,
  workspace_id uuid,
  subject_hash text CHECK (subject_hash IS NULL OR subject_hash ~ '^[0-9a-f]{32,64}$'),
  request_id text CHECK (request_id IS NULL OR request_id ~ '^[A-Za-z0-9_.:/-]{1,160}$'),
  source text NOT NULL CHECK (source IN ('edge', 'database', 'client', 'monitor')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE private.security_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.security_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE private.security_events_id_seq FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX security_events_occurred_at_idx
  ON private.security_events (occurred_at DESC);
CREATE INDEX security_events_actor_idx
  ON private.security_events (actor_user_id, occurred_at DESC)
  WHERE actor_user_id IS NOT NULL;
CREATE INDEX security_events_workspace_idx
  ON private.security_events (workspace_id, occurred_at DESC)
  WHERE workspace_id IS NOT NULL;
CREATE INDEX security_events_type_outcome_idx
  ON private.security_events (event_type, outcome, occurred_at DESC);

CREATE OR REPLACE FUNCTION private.write_security_event(
  p_event_type text,
  p_outcome text,
  p_actor_user_id uuid DEFAULT NULL,
  p_target_user_id uuid DEFAULT NULL,
  p_workspace_id uuid DEFAULT NULL,
  p_subject_hash text DEFAULT NULL,
  p_request_id text DEFAULT NULL,
  p_source text DEFAULT 'database',
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, pg_catalog
AS $$
DECLARE
  v_id bigint;
  v_key text;
  v_value jsonb;
  v_metadata jsonb := COALESCE(p_metadata, '{}'::jsonb);
BEGIN
  IF p_event_type !~ '^[a-z][a-z0-9_.-]{2,79}$'
     OR p_outcome NOT IN ('success', 'failure', 'blocked')
     OR p_source NOT IN ('edge', 'database', 'client', 'monitor')
     OR (p_subject_hash IS NOT NULL AND p_subject_hash !~ '^[0-9a-f]{32,64}$')
     OR (p_request_id IS NOT NULL AND p_request_id !~ '^[A-Za-z0-9_.:/-]{1,160}$') THEN
    RAISE EXCEPTION 'Invalid security event';
  END IF;

  IF jsonb_typeof(v_metadata) <> 'object'
     OR octet_length(v_metadata::text) > 2048 THEN
    RAISE EXCEPTION 'Invalid security event metadata';
  END IF;

  FOR v_key, v_value IN SELECT key, value FROM jsonb_each(v_metadata) LOOP
    IF v_key !~ '^[a-z][a-z0-9_]{0,39}$'
       OR v_key ~* '(password|token|secret|authorization|captcha|cookie|email|ip|credential)'
       OR jsonb_typeof(v_value) NOT IN ('string', 'number', 'boolean', 'null')
       OR octet_length(v_value::text) > 256 THEN
      RAISE EXCEPTION 'Sensitive or invalid security event metadata';
    END IF;
  END LOOP;

  -- Enforce retention opportunistically even when pg_cron is unavailable.
  DELETE FROM private.security_events
  WHERE occurred_at < clock_timestamp() - interval '90 days';

  INSERT INTO private.security_events(
    event_type, outcome, actor_user_id, target_user_id, workspace_id,
    subject_hash, request_id, source, metadata
  ) VALUES (
    p_event_type, p_outcome, p_actor_user_id, p_target_user_id, p_workspace_id,
    p_subject_hash, p_request_id, p_source, v_metadata
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION private.write_security_event(text, text, uuid, uuid, uuid, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_security_event(
  p_event_type text,
  p_outcome text,
  p_actor_user_id uuid DEFAULT NULL,
  p_target_user_id uuid DEFAULT NULL,
  p_workspace_id uuid DEFAULT NULL,
  p_subject_hash text DEFAULT NULL,
  p_request_id text DEFAULT NULL,
  p_source text DEFAULT 'edge',
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Недостаточно прав';
  END IF;
  RETURN private.write_security_event(
    p_event_type, p_outcome, p_actor_user_id, p_target_user_id,
    p_workspace_id, p_subject_hash, p_request_id, p_source, p_metadata
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_security_event(text, text, uuid, uuid, uuid, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_security_event(text, text, uuid, uuid, uuid, text, text, text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.purge_security_events()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, pg_catalog
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM private.security_events
  WHERE occurred_at < clock_timestamp() - interval '90 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_security_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_security_events() TO service_role;

CREATE OR REPLACE FUNCTION private.audit_workspace_member_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, pg_catalog
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    PERFORM private.write_security_event(
      'workspace.role_change', 'success', auth.uid(), NEW.user_id,
      NEW.workspace_id, NULL, NULL, 'database',
      jsonb_build_object('old_role', OLD.role::text, 'new_role', NEW.role::text)
    );
  END IF;
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    PERFORM private.write_security_event(
      CASE WHEN NEW.is_active THEN 'workspace.member_reactivate' ELSE 'workspace.member_remove' END,
      'success', auth.uid(), NEW.user_id, NEW.workspace_id, NULL, NULL, 'database', '{}'::jsonb
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.audit_workspace_member_change()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS audit_workspace_member_change ON public.workspace_members;
CREATE TRIGGER audit_workspace_member_change
  AFTER UPDATE OF role, is_active ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION private.audit_workspace_member_change();

CREATE OR REPLACE FUNCTION private.audit_workspace_soft_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, pg_catalog
AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    PERFORM private.write_security_event(
      'workspace.delete', 'success', auth.uid(), NULL, NEW.id,
      NULL, NULL, 'database', '{}'::jsonb
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.audit_workspace_soft_delete()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS audit_workspace_soft_delete ON public.workspaces;
CREATE TRIGGER audit_workspace_soft_delete
  AFTER UPDATE OF deleted_at ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION private.audit_workspace_soft_delete();

CREATE OR REPLACE FUNCTION private.audit_invitation_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'pending' THEN
      PERFORM private.write_security_event(
        'invitation.cancel', 'success', auth.uid(), NULL, OLD.workspace_id,
        NULL, NULL, 'database', '{}'::jsonb
      );
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'declined' THEN
    PERFORM private.write_security_event(
      'invitation.cancel', 'success', auth.uid(), NULL, NEW.workspace_id,
      NULL, NULL, 'database', '{}'::jsonb
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.audit_invitation_status_change()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS audit_invitation_status_change ON public.workspace_invitations;
CREATE TRIGGER audit_invitation_status_change
  AFTER UPDATE OF status ON public.workspace_invitations
  FOR EACH ROW EXECUTE FUNCTION private.audit_invitation_status_change();
DROP TRIGGER IF EXISTS audit_invitation_delete ON public.workspace_invitations;
CREATE TRIGGER audit_invitation_delete
  AFTER DELETE ON public.workspace_invitations
  FOR EACH ROW EXECUTE FUNCTION private.audit_invitation_status_change();

-- Keep the existing password-step-up restore boundary and add an authoritative
-- event only after the transactional restore succeeds.
CREATE OR REPLACE FUNCTION public.restore_workspace_backup(
  p_workspace_id uuid,
  p_backup jsonb,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_catalog
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.current_session_has_fresh_password() THEN
    RAISE EXCEPTION 'Повторно подтвердите текущий пароль';
  END IF;

  v_result := public.restore_workspace_backup_password_internal(p_workspace_id, p_backup, p_dry_run);
  IF NOT p_dry_run THEN
    PERFORM private.write_security_event(
      'workspace.restore', 'success', auth.uid(), NULL, p_workspace_id,
      NULL, NULL, 'database', '{}'::jsonb
    );
  END IF;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_workspace_backup(uuid, jsonb, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_workspace_backup(uuid, jsonb, boolean)
  TO authenticated, service_role;

-- Keep the existing password-session validation and log only a successful,
-- committed self-service deletion. The UUID is retained for at most 90 days.
CREATE OR REPLACE FUNCTION public.delete_my_account(p_confirmation_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, auth, pg_catalog
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_claims jsonb := auth.jwt();
  v_session_id uuid;
  v_has_recent_password boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация';
  END IF;

  BEGIN
    v_session_id := NULLIF(v_claims ->> 'session_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_session_id := NULL;
  END;

  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(v_claims -> 'amr', '[]'::jsonb)) AS method
    WHERE method ->> 'method' = 'password'
      AND (method ->> 'timestamp') ~ '^[0-9]+$'
      AND (method ->> 'timestamp')::bigint
        >= extract(epoch FROM clock_timestamp() - interval '5 minutes')::bigint
  ) INTO v_has_recent_password;

  IF v_session_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM auth.sessions session
       WHERE session.id = v_session_id AND session.user_id = v_actor
     )
     OR NOT v_has_recent_password THEN
    RAISE EXCEPTION 'Повторно подтвердите текущий пароль';
  END IF;

  PERFORM public.delete_my_account_internal(p_confirmation_email);
  PERFORM private.write_security_event(
    'account.delete', 'success', v_actor, NULL, NULL,
    NULL, NULL, 'database', '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_my_account(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account(text) TO authenticated;

-- Schedule strict retention when pg_cron is available. Opportunistic cleanup
-- in the writer remains the fallback on local/free environments without it.
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'fintrack-security-events-retention';
    IF v_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_job_id);
    END IF;
    PERFORM cron.schedule(
      'fintrack-security-events-retention',
      '23 3 * * *',
      'SELECT public.purge_security_events();'
    );
  END IF;
END;
$$;

COMMIT;
