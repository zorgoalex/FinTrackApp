-- Activate the password proof gate only after the password-auth Edge Function
-- and frontend have been deployed. Keeping activation separate avoids Auth
-- downtime during the production rollout.

DROP TRIGGER IF EXISTS enforce_password_policy_proof_trigger ON auth.users;
CREATE TRIGGER enforce_password_policy_proof_trigger
  BEFORE INSERT OR UPDATE OF encrypted_password ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_password_policy_proof();
