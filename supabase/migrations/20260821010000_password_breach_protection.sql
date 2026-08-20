-- Zero-cost server-enforced password breach protection.
-- Edge Functions issue one-minute, single-use proofs only after a padded HIBP
-- k-anonymity check. Password writes without a matching proof are rejected.

CREATE TABLE public.password_policy_proofs (
  token uuid PRIMARY KEY,
  purpose text NOT NULL CHECK (purpose IN ('signup', 'update')),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT password_policy_proof_subject_check CHECK (
    (purpose = 'signup' AND user_id IS NULL AND email IS NOT NULL)
    OR (purpose = 'update' AND user_id IS NOT NULL AND email IS NULL)
  )
);

CREATE INDEX password_policy_proofs_expiry_idx
  ON public.password_policy_proofs (expires_at);

ALTER TABLE public.password_policy_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.password_policy_proofs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.password_policy_proofs TO service_role;
GRANT SELECT, DELETE ON TABLE public.password_policy_proofs TO supabase_auth_admin;

CREATE OR REPLACE FUNCTION public.enforce_password_policy_proof()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_purpose text;
  v_token uuid;
  v_consumed uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.encrypted_password IS NULL OR NEW.encrypted_password = '' THEN
      RETURN NEW;
    END IF;
    v_purpose := 'signup';
  ELSE
    IF NEW.encrypted_password IS NOT DISTINCT FROM OLD.encrypted_password THEN
      RETURN NEW;
    END IF;
    v_purpose := 'update';
  END IF;

  BEGIN
    v_token := NULLIF(COALESCE(NEW.raw_user_meta_data, '{}'::jsonb)->>'_password_policy_proof', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_token := NULL;
  END;

  IF v_token IS NULL THEN
    RAISE EXCEPTION 'Password rejected by security policy' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.password_policy_proofs
  WHERE token = v_token
    AND purpose = v_purpose
    AND expires_at > clock_timestamp()
    AND (
      (v_purpose = 'signup' AND lower(email) = lower(NEW.email))
      OR (v_purpose = 'update' AND user_id = NEW.id)
    )
  RETURNING token INTO v_consumed;

  IF v_consumed IS NULL THEN
    RAISE EXCEPTION 'Password rejected by security policy' USING ERRCODE = 'P0001';
  END IF;

  NEW.raw_user_meta_data := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb) - '_password_policy_proof';
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_password_policy_proof() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_password_policy_proof() TO supabase_auth_admin;
