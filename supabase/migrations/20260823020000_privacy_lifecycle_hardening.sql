BEGIN;

-- Historical versions stored the AI question itself. New runtime versions only
-- store a one-way fingerprint; convert legacy rows before enforcing that shape.
UPDATE public.ai_assistant_logs
SET question = 'sha256:' || encode(extensions.digest(convert_to(question, 'UTF8'), 'sha256'), 'hex')
WHERE question !~ '^sha256:[0-9a-f]{64}$';

ALTER TABLE public.ai_assistant_logs
  DROP CONSTRAINT IF EXISTS ai_assistant_logs_question_fingerprint_check;
ALTER TABLE public.ai_assistant_logs
  ADD CONSTRAINT ai_assistant_logs_question_fingerprint_check
  CHECK (question ~ '^sha256:[0-9a-f]{64}$');

-- A browser session must not be able to create arbitrary log content. The
-- authenticated Edge Function writes bounded fingerprints with service_role.
DROP POLICY IF EXISTS ai_assistant_logs_insert ON public.ai_assistant_logs;
REVOKE INSERT ON public.ai_assistant_logs FROM authenticated;
GRANT INSERT ON public.ai_assistant_logs TO service_role;

CREATE OR REPLACE FUNCTION public.purge_expired_privacy_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_ai_logs integer;
  v_invitations integer;
  v_telegram_tokens integer;
  v_password_proofs integer;
  v_rate_limits integer;
  v_telegram_updates integer;
  v_financial_receipts integer;
  v_offline_receipts integer;
BEGIN
  DELETE FROM public.ai_assistant_logs
  WHERE created_at < clock_timestamp() - interval '30 days';
  GET DIAGNOSTICS v_ai_logs = ROW_COUNT;

  DELETE FROM public.workspace_invitations
  WHERE (status <> 'pending' AND updated_at < clock_timestamp() - interval '30 days')
     OR expires_at < clock_timestamp() - interval '30 days';
  GET DIAGNOSTICS v_invitations = ROW_COUNT;

  DELETE FROM public.telegram_link_tokens
  WHERE expires_at < clock_timestamp() - interval '1 day'
     OR used_at < clock_timestamp() - interval '1 day';
  GET DIAGNOSTICS v_telegram_tokens = ROW_COUNT;

  DELETE FROM public.password_policy_proofs
  WHERE expires_at <= clock_timestamp();
  GET DIAGNOSTICS v_password_proofs = ROW_COUNT;

  DELETE FROM public.security_rate_limits
  WHERE expires_at <= clock_timestamp();
  GET DIAGNOSTICS v_rate_limits = ROW_COUNT;

  DELETE FROM public.telegram_webhook_updates
  WHERE received_at < clock_timestamp() - interval '7 days';
  GET DIAGNOSTICS v_telegram_updates = ROW_COUNT;

  DELETE FROM private.financial_write_requests
  WHERE expires_at <= clock_timestamp();
  GET DIAGNOSTICS v_financial_receipts = ROW_COUNT;

  DELETE FROM public.offline_operation_requests
  WHERE created_at < clock_timestamp() - interval '30 days';
  GET DIAGNOSTICS v_offline_receipts = ROW_COUNT;

  RETURN jsonb_build_object(
    'ai_logs', v_ai_logs,
    'invitations', v_invitations,
    'telegram_tokens', v_telegram_tokens,
    'password_proofs', v_password_proofs,
    'rate_limits', v_rate_limits,
    'telegram_updates', v_telegram_updates,
    'financial_receipts', v_financial_receipts,
    'offline_receipts', v_offline_receipts
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_privacy_data() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_privacy_data() TO service_role;

CREATE OR REPLACE FUNCTION private.cleanup_account_privacy_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF OLD.email IS NOT NULL THEN
    DELETE FROM public.workspace_invitations
    WHERE lower(invited_email) = lower(OLD.email);

    DELETE FROM public.password_policy_proofs
    WHERE email IS NOT NULL AND lower(email) = lower(OLD.email);
  END IF;

  -- HMAC-obscured subjects expire independently; only directly correlatable
  -- UUID subjects can and should be removed synchronously.
  DELETE FROM public.security_rate_limits
  WHERE subject = OLD.id::text OR subject LIKE '%:' || OLD.id::text;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION private.cleanup_account_privacy_before_delete()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS cleanup_account_privacy_before_delete ON auth.users;
CREATE TRIGGER cleanup_account_privacy_before_delete
BEFORE DELETE ON auth.users
FOR EACH ROW EXECUTE FUNCTION private.cleanup_account_privacy_before_delete();

-- Apply the policy immediately, then keep it enforced for dormant beta data.
SELECT public.purge_expired_privacy_data();

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'fintrack-privacy-retention';
    IF v_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_job_id);
    END IF;
    PERFORM cron.schedule(
      'fintrack-privacy-retention',
      '41 3 * * *',
      'SELECT public.purge_expired_privacy_data();'
    );
  END IF;
END;
$$;

COMMENT ON FUNCTION public.purge_expired_privacy_data() IS
  'Deletes expired privacy-sensitive and transient operational records under the documented retention policy.';
COMMENT ON CONSTRAINT ai_assistant_logs_question_fingerprint_check ON public.ai_assistant_logs IS
  'AI logs contain only a SHA-256 fingerprint, never the original user question.';

COMMIT;
