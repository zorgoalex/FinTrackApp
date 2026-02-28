-- =====================================
-- Phase 6: Accounts/Wallets table
-- =====================================

BEGIN;

CREATE TABLE public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CONSTRAINT accounts_name_not_empty CHECK (btrim(name) <> ''),
  color text NOT NULL DEFAULT '#6B7280',
  is_default boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Only one default account per workspace
CREATE UNIQUE INDEX uq_accounts_default_per_workspace
  ON public.accounts(workspace_id) WHERE is_default = true;

-- Unique name within workspace
CREATE UNIQUE INDEX uq_accounts_workspace_name
  ON public.accounts(workspace_id, lower(name));

CREATE INDEX idx_accounts_workspace ON public.accounts(workspace_id);

-- Compound unique for FK from operations
ALTER TABLE public.accounts ADD CONSTRAINT accounts_id_workspace_unique UNIQUE (id, workspace_id);

-- Updated_at trigger
CREATE TRIGGER update_accounts_updated_at
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accounts_select_policy" ON public.accounts FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = accounts.workspace_id
      AND wm.user_id = auth.uid() AND wm.is_active = true
  ));

CREATE POLICY "accounts_insert_policy" ON public.accounts FOR INSERT
  WITH CHECK (user_has_role(auth.uid(), workspace_id, ARRAY['Owner'::text, 'Admin'::text]));

CREATE POLICY "accounts_update_policy" ON public.accounts FOR UPDATE
  USING (user_has_role(auth.uid(), workspace_id, ARRAY['Owner'::text, 'Admin'::text]))
  WITH CHECK (user_has_role(auth.uid(), workspace_id, ARRAY['Owner'::text, 'Admin'::text]));

CREATE POLICY "accounts_delete_policy" ON public.accounts FOR DELETE
  USING (user_has_role(auth.uid(), workspace_id, ARRAY['Owner'::text, 'Admin'::text]));

-- Protect default account from deletion/archiving
CREATE OR REPLACE FUNCTION public.protect_default_account()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.is_default THEN
    RAISE EXCEPTION 'Нельзя удалить основной счёт';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_default AND NEW.is_archived THEN
    RAISE EXCEPTION 'Нельзя архивировать основной счёт';
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;

CREATE TRIGGER trg_protect_default_account
  BEFORE UPDATE OR DELETE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.protect_default_account();

-- Auto-create default account when workspace is created
CREATE OR REPLACE FUNCTION public.create_default_account_for_workspace()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.accounts (workspace_id, name, color, is_default)
  VALUES (NEW.id, 'Основной счёт', '#6B7280', true)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_workspace_create_default_account
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.create_default_account_for_workspace();

-- Backfill: create default account for all existing workspaces
INSERT INTO public.accounts (workspace_id, name, color, is_default)
SELECT w.id, 'Основной счёт', '#6B7280', true
FROM public.workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM public.accounts a WHERE a.workspace_id = w.id AND a.is_default = true
);

COMMIT;
