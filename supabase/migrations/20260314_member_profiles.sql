-- Secure member roster including email addresses for active workspace members.

CREATE OR REPLACE FUNCTION public.get_workspace_member_profiles(p_workspace_id uuid)
RETURNS TABLE (
  user_id uuid,
  email text,
  role text,
  joined_at timestamptz,
  last_accessed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT wm.user_id, u.email::text, wm.role::text, wm.joined_at, wm.last_accessed_at
  FROM public.workspace_members wm
  JOIN auth.users u ON u.id = wm.user_id
  WHERE wm.workspace_id = p_workspace_id
    AND wm.is_active
    AND public.is_workspace_member((SELECT auth.uid()), p_workspace_id)
  ORDER BY lower(wm.role::text) = 'owner' DESC, u.email;
$$;

REVOKE ALL ON FUNCTION public.get_workspace_member_profiles(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_workspace_member_profiles(uuid) TO authenticated;
