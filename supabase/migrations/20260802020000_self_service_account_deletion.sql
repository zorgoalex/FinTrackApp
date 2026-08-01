-- Atomic self-service account deletion. Rows in workspaces owned by the actor
-- disappear with the workspace. Authorship in other people's workspaces is
-- transferred to that workspace owner so ON DELETE RESTRICT audit rows do not
-- block deletion or erase shared business records.

CREATE OR REPLACE FUNCTION public.protect_default_account()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.is_default
     AND current_setting('fintrack.delete_workspace', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Нельзя удалить основной счёт';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_default AND NEW.is_archived THEN
    RAISE EXCEPTION 'Нельзя архивировать основной счёт';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_counterparty_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (
       NEW.created_by IS DISTINCT FROM OLD.created_by
       AND current_setting('fintrack.delete_account', true) IS DISTINCT FROM 'on'
     ) THEN
    RAISE EXCEPTION 'Системные реквизиты контрагента нельзя изменять';
  END IF;
  IF NEW.merged_into_id IS DISTINCT FROM OLD.merged_into_id
     AND current_setting('fintrack.counterparty_merge', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Объединение контрагентов выполняется только через merge_counterparties';
  END IF;
  IF current_setting('fintrack.delete_account', true) = 'on' THEN
    NEW.updated_by := COALESCE(NEW.updated_by, NEW.created_by, OLD.updated_by);
  ELSE
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by, OLD.updated_by);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_import_template_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (
       NEW.created_by IS DISTINCT FROM OLD.created_by
       AND current_setting('fintrack.delete_account', true) IS DISTINCT FROM 'on'
     ) THEN
    RAISE EXCEPTION 'Системные реквизиты шаблона импорта нельзя изменять';
  END IF;
  IF current_setting('fintrack.delete_account', true) = 'on' THEN
    NEW.updated_by := COALESCE(NEW.updated_by, NEW.created_by, OLD.updated_by);
  ELSE
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by, OLD.updated_by);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_my_account(p_confirmation_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация';
  END IF;

  SELECT email INTO v_email
  FROM auth.users
  WHERE id = v_actor
  FOR UPDATE;

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'Аккаунт не найден';
  END IF;
  IF lower(trim(COALESCE(p_confirmation_email, ''))) <> lower(v_email) THEN
    RAISE EXCEPTION 'Для подтверждения введите email текущего аккаунта';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_actor::text, 0));

  -- Owned workspaces contain data belonging to the deleting account and are
  -- removed first, including memberships and workspace-scoped audit rows.
  PERFORM set_config('fintrack.delete_workspace', 'on', true);
  DELETE FROM public.workspaces
  WHERE owner_id = v_actor;

  -- Keep shared-workspace records, but transfer their immutable authorship to
  -- the current workspace owner before the auth user is removed.
  PERFORM set_config('fintrack.delete_account', 'on', true);
  UPDATE public.counterparties item
  SET created_by = workspace.owner_id,
      updated_by = workspace.owner_id
  FROM public.workspaces workspace
  WHERE item.workspace_id = workspace.id
    AND item.created_by = v_actor;

  UPDATE public.debts item
  SET created_by = workspace.owner_id
  FROM public.workspaces workspace
  WHERE item.workspace_id = workspace.id
    AND item.created_by = v_actor;

  UPDATE public.import_templates item
  SET created_by = workspace.owner_id,
      updated_by = workspace.owner_id
  FROM public.workspaces workspace
  WHERE item.workspace_id = workspace.id
    AND item.created_by = v_actor;

  UPDATE public.operation_split_groups item
  SET created_by = workspace.owner_id
  FROM public.workspaces workspace
  WHERE item.source_workspace_id = workspace.id
    AND item.created_by = v_actor;

  UPDATE public.savings_goal_contributions contribution
  SET created_by = workspace.owner_id
  FROM public.savings_goals goal
  JOIN public.workspaces workspace ON workspace.id = goal.workspace_id
  WHERE contribution.goal_id = goal.id
    AND contribution.created_by = v_actor;

  DELETE FROM auth.users WHERE id = v_actor;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Аккаунт не найден';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_my_account(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account(text) TO authenticated;
