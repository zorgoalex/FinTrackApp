-- Shared, learnable categorization rules and a database-level duplicate guard.

BEGIN;

CREATE TABLE IF NOT EXISTS public.category_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  operation_type text NOT NULL CHECK (operation_type IN ('income', 'expense', 'personal_salary', 'employee_salary')),
  pattern text NOT NULL CHECK (
    pattern = lower(btrim(pattern))
    AND char_length(pattern) BETWEEN 3 AND 120
  ),
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  match_mode text NOT NULL DEFAULT 'contains' CHECK (match_mode = 'contains'),
  priority integer NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 1000),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, operation_type, pattern)
);

CREATE INDEX IF NOT EXISTS category_rules_workspace_active_idx
  ON public.category_rules(workspace_id, operation_type, priority, updated_at DESC)
  WHERE is_active;

ALTER TABLE public.category_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS category_rules_select ON public.category_rules;
CREATE POLICY category_rules_select ON public.category_rules FOR SELECT
  USING (public.is_workspace_member((SELECT auth.uid()), workspace_id));

DROP POLICY IF EXISTS category_rules_insert ON public.category_rules;
CREATE POLICY category_rules_insert ON public.category_rules FOR INSERT
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin', 'Member'])
  );

DROP POLICY IF EXISTS category_rules_update ON public.category_rules;
CREATE POLICY category_rules_update ON public.category_rules FOR UPDATE
  USING (
    created_by = (SELECT auth.uid())
    OR public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin'])
  )
  WITH CHECK (
    public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin', 'Member'])
  );

DROP POLICY IF EXISTS category_rules_delete ON public.category_rules;
CREATE POLICY category_rules_delete ON public.category_rules FOR DELETE
  USING (
    created_by = (SELECT auth.uid())
    OR public.user_has_role((SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin'])
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.category_rules TO authenticated;

CREATE OR REPLACE FUNCTION public.save_category_rule(
  p_workspace_id uuid,
  p_operation_type text,
  p_pattern text,
  p_category_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_pattern text := lower(btrim(COALESCE(p_pattern, '')));
  v_category_type text;
  v_expected_category_type text;
  v_rule_id uuid;
BEGIN
  IF v_user_id IS NULL OR NOT public.user_has_role(v_user_id, p_workspace_id, ARRAY['Owner', 'Admin', 'Member']) THEN
    RAISE EXCEPTION 'Нет права создавать правила категоризации';
  END IF;
  IF p_operation_type NOT IN ('income', 'expense', 'personal_salary', 'employee_salary') THEN
    RAISE EXCEPTION 'Некорректный тип операции';
  END IF;
  IF char_length(v_pattern) NOT BETWEEN 3 AND 120 THEN
    RAISE EXCEPTION 'Шаблон правила должен содержать от 3 до 120 символов';
  END IF;

  SELECT type INTO v_category_type FROM public.categories
  WHERE id = p_category_id AND workspace_id = p_workspace_id AND NOT is_archived;
  IF v_category_type IS NULL THEN RAISE EXCEPTION 'Категория не найдена или находится в архиве'; END IF;
  v_expected_category_type := CASE WHEN p_operation_type IN ('income', 'personal_salary') THEN 'income' ELSE 'expense' END;
  IF v_category_type <> v_expected_category_type THEN RAISE EXCEPTION 'Категория не соответствует типу операции'; END IF;

  INSERT INTO public.category_rules
    (workspace_id, operation_type, pattern, category_id, created_by, updated_by)
  VALUES
    (p_workspace_id, p_operation_type, v_pattern, p_category_id, v_user_id, v_user_id)
  ON CONFLICT (workspace_id, operation_type, pattern) DO UPDATE SET
    category_id = EXCLUDED.category_id,
    is_active = true,
    updated_by = v_user_id,
    updated_at = now()
  RETURNING id INTO v_rule_id;
  RETURN v_rule_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_category_rule(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_category_rule(uuid, text, text, uuid) TO authenticated;

-- The UI pre-check improves UX; this index is the final race-safe guarantee.
CREATE UNIQUE INDEX IF NOT EXISTS operations_workspace_import_fingerprint_unique_idx
  ON public.operations(workspace_id, import_fingerprint)
  WHERE import_fingerprint IS NOT NULL;

COMMIT;
