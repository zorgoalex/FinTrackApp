BEGIN;

CREATE OR REPLACE FUNCTION public.bulk_update_operations(
  p_workspace_id uuid,
  p_operation_ids uuid[],
  p_category_id uuid DEFAULT NULL,
  p_set_category boolean DEFAULT false,
  p_status text DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_tag_ids uuid[] DEFAULT NULL,
  p_replace_tags boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_has_role(auth.uid(), p_workspace_id, ARRAY['Owner','Admin']) THEN
    RAISE EXCEPTION 'Только владелец или администратор может массово изменять операции';
  END IF;
  v_count := COALESCE(array_length(p_operation_ids, 1), 0);
  IF v_count < 1 OR v_count > 500 THEN RAISE EXCEPTION 'Выберите от 1 до 500 операций'; END IF;
  IF (SELECT count(DISTINCT id) FROM unnest(p_operation_ids) id) <> v_count THEN RAISE EXCEPTION 'Список операций содержит дубли'; END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_operation_ids) requested(id)
    LEFT JOIN public.operations operation ON operation.id=requested.id AND operation.workspace_id=p_workspace_id
    WHERE operation.id IS NULL
  ) THEN RAISE EXCEPTION 'Одна или несколько операций не принадлежат пространству'; END IF;
  IF EXISTS (SELECT 1 FROM public.operations WHERE id=ANY(p_operation_ids) AND type='transfer') THEN
    RAISE EXCEPTION 'Переводы изменяются только по одному';
  END IF;
  IF p_set_category AND p_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.categories WHERE id=p_category_id AND workspace_id=p_workspace_id AND NOT is_archived
  ) THEN RAISE EXCEPTION 'Категория не принадлежит пространству или архивирована'; END IF;
  IF p_tag_ids IS NOT NULL AND EXISTS (
    SELECT 1 FROM unnest(p_tag_ids) requested(id)
    LEFT JOIN public.tags tag ON tag.id=requested.id AND tag.workspace_id=p_workspace_id AND NOT tag.is_archived
    WHERE tag.id IS NULL
  ) THEN RAISE EXCEPTION 'Один или несколько тегов недоступны'; END IF;
  IF NOT p_set_category AND p_status IS NULL AND p_tag_ids IS NULL AND NOT p_replace_tags THEN
    RAISE EXCEPTION 'Не выбрано ни одного изменения';
  END IF;

  PERFORM 1 FROM public.operations WHERE id=ANY(p_operation_ids) ORDER BY id FOR UPDATE;
  IF p_set_category THEN
    UPDATE public.operations SET category_id=p_category_id WHERE id=ANY(p_operation_ids);
  END IF;
  IF p_status IS NOT NULL THEN
    FOREACH v_id IN ARRAY p_operation_ids LOOP
      PERFORM public.transition_operation_status(v_id,p_status,p_reason);
    END LOOP;
  END IF;
  IF p_replace_tags THEN DELETE FROM public.operation_tags WHERE operation_id=ANY(p_operation_ids); END IF;
  IF p_tag_ids IS NOT NULL THEN
    INSERT INTO public.operation_tags(operation_id,tag_id)
    SELECT operation_id,tag_id FROM unnest(p_operation_ids) operation_id CROSS JOIN unnest(p_tag_ids) tag_id
    ON CONFLICT (operation_id,tag_id) DO NOTHING;
  END IF;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_update_operations(uuid,uuid[],uuid,boolean,text,text,uuid[],boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bulk_update_operations(uuid,uuid[],uuid,boolean,text,text,uuid[],boolean) TO authenticated;
COMMIT;
