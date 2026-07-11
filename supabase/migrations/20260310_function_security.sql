-- Lock down the public function surface and make search_path deterministic.

CREATE OR REPLACE FUNCTION public.is_workspace_member(p_user_id uuid, p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    auth.uid() IS NULL
    OR auth.role() = 'service_role'
    OR p_user_id = auth.uid()
  ) AND EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.user_id = p_user_id
      AND wm.workspace_id = p_workspace_id
      AND wm.is_active
  );
$$;

CREATE OR REPLACE FUNCTION public.user_has_role(
  user_uuid uuid,
  workspace_uuid uuid,
  required_roles text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    auth.uid() IS NULL
    OR auth.role() = 'service_role'
    OR user_uuid = auth.uid()
  ) AND EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.user_id = user_uuid
      AND wm.workspace_id = workspace_uuid
      AND wm.is_active
      AND lower(wm.role::text) = ANY (
        ARRAY(SELECT lower(role_name) FROM unnest(required_roles) AS role_name)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_user_role_in_workspace(workspace_uuid uuid, user_uuid uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL
      AND auth.role() <> 'service_role'
      AND user_uuid <> auth.uid()
    THEN 'none'
    ELSE COALESCE((
      SELECT public.normalize_role(wm.role::text)
      FROM public.workspace_members wm
      WHERE wm.workspace_id = workspace_uuid
        AND wm.user_id = user_uuid
        AND wm.is_active
    ), 'none')
  END;
$$;

CREATE OR REPLACE FUNCTION public.user_can_manage_workspace(workspace_uuid uuid, user_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_has_role(user_uuid, workspace_uuid, ARRAY['Owner', 'Admin']);
$$;

ALTER FUNCTION public.protect_default_account() SET search_path = public;
ALTER FUNCTION public.validate_operation_debt() SET search_path = public;
ALTER FUNCTION public.get_exchange_rate(uuid, text, text, date) SET search_path = public;
ALTER FUNCTION public.get_debts_with_balance(uuid) SET search_path = public;

DO $$
DECLARE
  v_function record;
BEGIN
  FOR v_function IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_function.signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_function.signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', v_function.signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM service_role', v_function.signature);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_has_role(uuid, uuid, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_role_in_workspace(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.user_can_manage_workspace(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_exchange_rate(uuid, text, text, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_debts_with_balance(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_account_balances(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_transfer(uuid, uuid, uuid, uuid, numeric, text, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_transfer_v2(uuid, uuid, uuid, uuid, numeric, numeric, text, text, numeric, text, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_transfer(uuid, uuid, uuid, uuid, numeric, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workspace_operation_summary(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_workspace_operation_totals(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_scheduled_operations(integer) TO service_role;
