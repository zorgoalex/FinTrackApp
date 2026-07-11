-- Baseline schema required by all later FinTrackApp migrations.
-- This file intentionally contains only application-owned objects; Supabase
-- manages auth, storage, realtime, roles and extensions itself.

CREATE TYPE public.workspace_role AS ENUM ('Owner', 'Admin', 'Member', 'Viewer');

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_role(input_role text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE lower(input_role)
    WHEN 'owner' THEN 'Owner'
    WHEN 'admin' THEN 'Admin'
    WHEN 'member' THEN 'Member'
    WHEN 'viewer' THEN 'Viewer'
    ELSE input_role
  END;
$$;

CREATE TABLE public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> ''),
  is_personal boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  quick_buttons jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE public.workspace_members (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.workspace_role NOT NULL DEFAULT 'Member',
  invited_at timestamptz NOT NULL DEFAULT now(),
  joined_at timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE public.workspace_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_email text NOT NULL,
  role text NOT NULL CHECK (lower(role) IN ('owner', 'admin', 'member', 'viewer')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  invitation_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  invited_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  declined_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  email_sent_at timestamptz,
  email_sent_count integer NOT NULL DEFAULT 0,
  last_reminded_at timestamptz,
  CONSTRAINT valid_expiry CHECK (expires_at > invited_at)
);

CREATE UNIQUE INDEX unique_workspace_email_pending
  ON public.workspace_invitations (workspace_id, lower(invited_email))
  WHERE status = 'pending';
CREATE INDEX idx_workspace_invitations_email ON public.workspace_invitations (lower(invited_email));
CREATE INDEX idx_workspace_invitations_token ON public.workspace_invitations (invitation_token);
CREATE INDEX idx_workspace_members_user ON public.workspace_members (user_id) WHERE is_active;
CREATE INDEX idx_workspace_members_role ON public.workspace_members (workspace_id, role);

CREATE OR REPLACE FUNCTION public.is_workspace_member(p_user_id uuid, p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members wm
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
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members wm
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
  SELECT COALESCE((
    SELECT public.normalize_role(wm.role::text)
    FROM public.workspace_members wm
    WHERE wm.workspace_id = workspace_uuid
      AND wm.user_id = user_uuid
      AND wm.is_active
  ), 'none');
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

CREATE OR REPLACE FUNCTION public.create_personal_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace_id uuid;
BEGIN
  INSERT INTO public.workspaces (owner_id, name, is_personal)
  VALUES (NEW.id, 'Personal', true)
  RETURNING id INTO v_workspace_id;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (v_workspace_id, NEW.id, 'Owner');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.create_personal_workspace();

CREATE TRIGGER update_workspaces_updated_at
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_workspace_invitations_updated_at
  BEFORE UPDATE ON public.workspace_invitations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> ''),
  type text NOT NULL CHECK (type IN ('income', 'expense')),
  color text NOT NULL DEFAULT '#6B7280',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name, type)
);

CREATE TABLE public.tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> ''),
  color text NOT NULL DEFAULT '#6B7280',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

CREATE TABLE public.scheduled_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  type text NOT NULL CHECK (type IN ('income', 'expense', 'salary')),
  description text,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  frequency text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
  next_date date NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_categories_workspace ON public.categories (workspace_id);
CREATE INDEX idx_tags_workspace ON public.tags (workspace_id);
CREATE INDEX idx_scheduled_operations_due
  ON public.scheduled_operations (workspace_id, next_date)
  WHERE is_active;

CREATE TRIGGER update_categories_updated_at BEFORE UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_tags_updated_at BEFORE UPDATE ON public.tags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_scheduled_operations_updated_at BEFORE UPDATE ON public.scheduled_operations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_operations ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspaces_select ON public.workspaces FOR SELECT USING (
  owner_id = auth.uid() OR public.is_workspace_member(auth.uid(), id)
);
CREATE POLICY workspaces_insert ON public.workspaces FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY workspaces_update ON public.workspaces FOR UPDATE
  USING (public.user_has_role(auth.uid(), id, ARRAY['Owner', 'Admin']))
  WITH CHECK (public.user_has_role(auth.uid(), id, ARRAY['Owner', 'Admin']));
CREATE POLICY workspaces_delete ON public.workspaces FOR DELETE USING (owner_id = auth.uid());

CREATE POLICY workspace_members_select ON public.workspace_members FOR SELECT USING (
  user_id = auth.uid() OR public.is_workspace_member(auth.uid(), workspace_id)
);
CREATE POLICY workspace_members_insert ON public.workspace_members FOR INSERT WITH CHECK (
  public.user_has_role(auth.uid(), workspace_id, ARRAY['Owner', 'Admin'])
  OR (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid())
  )
  OR (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.workspace_invitations wi
      JOIN auth.users au ON au.id = auth.uid()
      WHERE wi.workspace_id = workspace_members.workspace_id
        AND lower(wi.invited_email) = lower(au.email)
        AND wi.status = 'pending'
        AND wi.expires_at > now()
    )
  )
);
CREATE POLICY workspace_members_update ON public.workspace_members FOR UPDATE
  USING (public.user_has_role(auth.uid(), workspace_id, ARRAY['Owner', 'Admin']) OR user_id = auth.uid())
  WITH CHECK (public.user_has_role(auth.uid(), workspace_id, ARRAY['Owner', 'Admin']) OR user_id = auth.uid());
CREATE POLICY workspace_members_delete ON public.workspace_members FOR DELETE USING (
  public.user_has_role(auth.uid(), workspace_id, ARRAY['Owner']) OR user_id = auth.uid()
);

CREATE POLICY invitations_select ON public.workspace_invitations FOR SELECT USING (
  invited_by = auth.uid()
  OR public.user_has_role(auth.uid(), workspace_id, ARRAY['Owner', 'Admin'])
  OR lower(invited_email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
);
CREATE POLICY invitations_insert ON public.workspace_invitations FOR INSERT WITH CHECK (
  invited_by = auth.uid()
  AND public.user_has_role(auth.uid(), workspace_id, ARRAY['Owner', 'Admin'])
);
CREATE POLICY invitations_update ON public.workspace_invitations FOR UPDATE USING (
  invited_by = auth.uid()
  OR public.user_has_role(auth.uid(), workspace_id, ARRAY['Owner', 'Admin'])
  OR lower(invited_email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
);
CREATE POLICY invitations_delete ON public.workspace_invitations FOR DELETE USING (
  invited_by = auth.uid() OR public.user_has_role(auth.uid(), workspace_id, ARRAY['Owner', 'Admin'])
);

CREATE POLICY categories_select ON public.categories FOR SELECT USING (
  public.is_workspace_member(auth.uid(), workspace_id)
);
CREATE POLICY categories_write ON public.categories FOR ALL
  USING (public.user_has_role(auth.uid(), workspace_id, ARRAY['Owner', 'Admin']))
  WITH CHECK (public.user_has_role(auth.uid(), workspace_id, ARRAY['Owner', 'Admin']));
CREATE POLICY tags_select ON public.tags FOR SELECT USING (
  public.is_workspace_member(auth.uid(), workspace_id)
);
CREATE POLICY tags_write ON public.tags FOR ALL
  USING (public.user_has_role(auth.uid(), workspace_id, ARRAY['Owner', 'Admin', 'Member']))
  WITH CHECK (public.user_has_role(auth.uid(), workspace_id, ARRAY['Owner', 'Admin', 'Member']));
CREATE POLICY scheduled_select ON public.scheduled_operations FOR SELECT USING (
  public.is_workspace_member(auth.uid(), workspace_id)
);
CREATE POLICY scheduled_insert ON public.scheduled_operations FOR INSERT WITH CHECK (
  user_id = auth.uid()
  AND public.user_has_role(auth.uid(), workspace_id, ARRAY['Owner', 'Admin', 'Member'])
);
CREATE POLICY scheduled_update ON public.scheduled_operations FOR UPDATE
  USING (public.user_has_role(auth.uid(), workspace_id, ARRAY['Owner', 'Admin']) OR user_id = auth.uid())
  WITH CHECK (public.user_has_role(auth.uid(), workspace_id, ARRAY['Owner', 'Admin']) OR user_id = auth.uid());
CREATE POLICY scheduled_delete ON public.scheduled_operations FOR DELETE USING (
  public.user_has_role(auth.uid(), workspace_id, ARRAY['Owner', 'Admin']) OR user_id = auth.uid()
);

GRANT USAGE ON TYPE public.workspace_role TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.workspaces,
  public.workspace_members,
  public.workspace_invitations,
  public.categories,
  public.tags,
  public.scheduled_operations
TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_has_role(uuid, uuid, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_role_in_workspace(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_can_manage_workspace(uuid, uuid) TO authenticated, service_role;
