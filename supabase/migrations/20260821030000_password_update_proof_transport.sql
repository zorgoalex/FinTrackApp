-- GoTrue writes a new password before user metadata supplied to updateUser is
-- available to auth.users triggers. Keep signup proofs in user metadata, but
-- carry password-update proofs in service-role-controlled app metadata that is
-- attached immediately before the password write.

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
  v_proof_metadata jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.encrypted_password IS NULL OR NEW.encrypted_password = '' THEN
      RETURN NEW;
    END IF;
    v_purpose := 'signup';
    v_proof_metadata := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  ELSE
    IF NEW.encrypted_password IS NOT DISTINCT FROM OLD.encrypted_password THEN
      RETURN NEW;
    END IF;
    v_purpose := 'update';
    v_proof_metadata := COALESCE(NEW.raw_app_meta_data, '{}'::jsonb);
  END IF;

  BEGIN
    v_token := NULLIF(v_proof_metadata->>'_password_policy_proof', '')::uuid;
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

  IF v_purpose = 'signup' THEN
    NEW.raw_user_meta_data := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb) - '_password_policy_proof';
  ELSE
    NEW.raw_app_meta_data := COALESCE(NEW.raw_app_meta_data, '{}'::jsonb) - '_password_policy_proof';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_password_policy_proof() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_password_policy_proof() TO supabase_auth_admin;
