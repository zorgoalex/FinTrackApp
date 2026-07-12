-- Prevent self-service role escalation through permissive membership/invitation updates.

BEGIN;

CREATE OR REPLACE FUNCTION public.protect_workspace_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'Владелец пространства изменяется только отдельной процедурой передачи';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_workspace_identity ON public.workspaces;
CREATE TRIGGER protect_workspace_identity
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_workspace_identity();

DROP POLICY IF EXISTS workspace_members_update ON public.workspace_members;
CREATE POLICY workspace_members_update ON public.workspace_members FOR UPDATE
  USING (
    public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner'])
    OR user_id = (SELECT auth.uid())
  )
  WITH CHECK (
    public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner'])
    OR user_id = (SELECT auth.uid())
  );

CREATE OR REPLACE FUNCTION public.protect_workspace_membership_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_owner uuid;
BEGIN
  -- Database maintenance and service-role flows do not carry an end-user JWT.
  IF v_actor IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Нельзя изменить идентификаторы участника';
  END IF;

  SELECT owner_id INTO v_owner
  FROM public.workspaces
  WHERE id = OLD.workspace_id;

  -- The canonical owner membership must remain active and keep the Owner role.
  IF OLD.user_id = v_owner AND (
    NEW.role IS DISTINCT FROM 'Owner'::public.workspace_role
    OR NEW.is_active IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'Нельзя изменить роль или отключить владельца пространства';
  END IF;

  IF v_actor = v_owner THEN
    IF NEW.user_id <> v_owner AND NEW.role = 'Owner'::public.workspace_role THEN
      RAISE EXCEPTION 'Роль владельца нельзя передать через изменение участника';
    END IF;
    RETURN NEW;
  END IF;

  IF v_actor <> OLD.user_id THEN
    RAISE EXCEPTION 'Недостаточно прав для изменения участника';
  END IF;

  -- A member may only record own access or leave the workspace. In particular,
  -- role, activation after leaving and membership timestamps are immutable.
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.invited_at IS DISTINCT FROM OLD.invited_at
     OR NEW.joined_at IS DISTINCT FROM OLD.joined_at
     OR (OLD.is_active = false AND NEW.is_active = true) THEN
    RAISE EXCEPTION 'Участник не может изменить собственную роль или восстановить доступ';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_workspace_membership_update
  ON public.workspace_members;
CREATE TRIGGER protect_workspace_membership_update
  BEFORE UPDATE ON public.workspace_members
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_workspace_membership_update();

DROP POLICY IF EXISTS workspace_members_insert ON public.workspace_members;
CREATE POLICY workspace_members_insert ON public.workspace_members FOR INSERT
  WITH CHECK (
    (
      public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin'])
      AND role <> 'Owner'::public.workspace_role
    )
    OR (
      user_id = (SELECT auth.uid())
      AND role = 'Owner'::public.workspace_role
      AND EXISTS (
        SELECT 1 FROM public.workspaces workspace
        WHERE workspace.id = workspace_id
          AND workspace.owner_id = (SELECT auth.uid())
      )
    )
    OR (
      user_id = (SELECT auth.uid())
      AND role <> 'Owner'::public.workspace_role
      AND EXISTS (
        SELECT 1
        FROM public.workspace_invitations invitation
        WHERE invitation.workspace_id = workspace_members.workspace_id
          AND lower(invitation.invited_email) = lower(COALESCE((SELECT auth.jwt() ->> 'email'), ''))
          AND lower(invitation.role) = lower(workspace_members.role::text)
          AND invitation.status = 'pending'
          AND invitation.expires_at > now()
      )
    )
  );

DROP POLICY IF EXISTS invitations_update ON public.workspace_invitations;
CREATE POLICY invitations_update ON public.workspace_invitations FOR UPDATE
  USING (
    invited_by = (SELECT auth.uid())
    OR public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin'])
  )
  WITH CHECK (
    invited_by = (SELECT auth.uid())
    OR public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin'])
  );

CREATE OR REPLACE FUNCTION public.protect_workspace_invitation_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.invited_by IS DISTINCT FROM OLD.invited_by
     OR NEW.invited_email IS DISTINCT FROM OLD.invited_email
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.invitation_token IS DISTINCT FROM OLD.invitation_token
     OR NEW.invited_at IS DISTINCT FROM OLD.invited_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at THEN
    RAISE EXCEPTION 'Реквизиты приглашения нельзя изменять напрямую';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'pending' AND NEW.status = 'declined') THEN
    RAISE EXCEPTION 'Недопустимый переход статуса приглашения';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_workspace_invitation_update
  ON public.workspace_invitations;
CREATE TRIGGER protect_workspace_invitation_update
  BEFORE UPDATE ON public.workspace_invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_workspace_invitation_update();

DROP POLICY IF EXISTS invitations_insert ON public.workspace_invitations;
CREATE POLICY invitations_insert ON public.workspace_invitations FOR INSERT
  WITH CHECK (
    invited_by = (SELECT auth.uid())
    AND lower(role) <> 'owner'
    AND public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin'])
  );

REVOKE ALL ON FUNCTION public.protect_workspace_membership_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_workspace_identity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_workspace_invitation_update() FROM PUBLIC, anon, authenticated;

COMMIT;
