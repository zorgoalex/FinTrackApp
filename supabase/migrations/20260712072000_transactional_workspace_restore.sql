-- Versioned, allow-listed and atomic workspace backup restore.
BEGIN;

CREATE OR REPLACE FUNCTION public.restore_workspace_recordset(
  p_table regclass,
  p_rows jsonb,
  p_workspace_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_columns text;
  v_select_columns text;
  v_updates text;
  v_count integer := COALESCE(jsonb_array_length(COALESCE(p_rows, '[]'::jsonb)), 0);
BEGIN
  IF v_count = 0 THEN RETURN 0; END IF;
  IF jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'Раздел резервной копии должен быть массивом'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rows) row_data
    WHERE row_data->>'workspace_id' IS DISTINCT FROM p_workspace_id::text
  ) THEN
    RAISE EXCEPTION 'Резервная копия содержит запись другого пространства';
  END IF;

  SELECT
    string_agg(format('%I', attribute.attname), ', ' ORDER BY attribute.attnum),
    string_agg(format('record.%I', attribute.attname), ', ' ORDER BY attribute.attnum),
    string_agg(format('%1$I = EXCLUDED.%1$I', attribute.attname), ', ' ORDER BY attribute.attnum)
      FILTER (WHERE attribute.attname <> 'id')
  INTO v_columns, v_select_columns, v_updates
  FROM pg_attribute attribute
  WHERE attribute.attrelid = p_table
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND attribute.attgenerated = ''
    AND attribute.attidentity = '';

  IF v_columns IS NULL THEN RAISE EXCEPTION 'Таблица восстановления не найдена'; END IF;
  EXECUTE format(
    'INSERT INTO %1$s (%2$s) SELECT %3$s FROM jsonb_populate_recordset(NULL::%1$s, $1) record '
    'ON CONFLICT (id) DO UPDATE SET %4$s',
    p_table, v_columns, v_select_columns, v_updates
  ) USING p_rows;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_workspace_recordset(regclass, jsonb, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.restore_workspace_backup(
  p_workspace_id uuid,
  p_backup jsonb,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_data jsonb;
  v_counts jsonb;
  v_total integer;
  v_key text;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_has_role(auth.uid(), p_workspace_id, ARRAY['Owner','Admin']) THEN
    RAISE EXCEPTION 'Только владелец или администратор может восстановить резервную копию';
  END IF;
  IF p_backup->>'format' IS DISTINCT FROM 'fintrack-workspace-backup'
     OR COALESCE((p_backup->>'version')::integer, 0) <> 2 THEN
    RAISE EXCEPTION 'Поддерживается резервная копия FinTrack версии 2';
  END IF;
  IF p_backup#>>'{workspace,id}' IS DISTINCT FROM p_workspace_id::text THEN
    RAISE EXCEPTION 'Копия создана для другого рабочего пространства';
  END IF;
  v_data := p_backup->'data';
  IF jsonb_typeof(v_data) <> 'object' THEN RAISE EXCEPTION 'В копии отсутствует раздел data'; END IF;

  v_counts := '{}'::jsonb;
  FOREACH v_key IN ARRAY ARRAY[
    'accounts','categories','tags','counterparties','exchangeRates','importTemplates',
    'importSessions','scheduledOperations','debts','operations','operationAllocations',
    'operationTags','operationComments','categoryRules','cashflowPlans','budgets',
    'savingsGoals','savingsGoalContributions'
  ] LOOP
    v_rows := COALESCE(v_data->v_key, '[]'::jsonb);
    IF jsonb_typeof(v_rows) <> 'array' THEN RAISE EXCEPTION 'Раздел % должен быть массивом', v_key; END IF;
    IF v_key <> 'operationTags' AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_rows) row_data
      WHERE row_data->>'workspace_id' IS DISTINCT FROM p_workspace_id::text
    ) THEN RAISE EXCEPTION 'Раздел % содержит запись другого пространства', v_key; END IF;
    v_counts := v_counts || jsonb_build_object(v_key, jsonb_array_length(v_rows));
  END LOOP;
  SELECT COALESCE(SUM(value::integer), 0) INTO v_total FROM jsonb_each_text(v_counts);
  IF v_total > 100000 THEN RAISE EXCEPTION 'Копия превышает лимит 100000 записей'; END IF;

  IF p_dry_run THEN
    RETURN jsonb_build_object('dryRun', true, 'valid', true, 'totalRows', v_total, 'counts', v_counts);
  END IF;

  -- Parents first, then dependent financial records. Every statement remains
  -- inside the surrounding PostgreSQL transaction.
  PERFORM public.restore_workspace_recordset('public.accounts', v_data->'accounts', p_workspace_id);
  PERFORM public.restore_workspace_recordset('public.categories', v_data->'categories', p_workspace_id);
  PERFORM public.restore_workspace_recordset('public.tags', v_data->'tags', p_workspace_id);
  PERFORM public.restore_workspace_recordset('public.counterparties', v_data->'counterparties', p_workspace_id);
  PERFORM public.restore_workspace_recordset('public.exchange_rates', v_data->'exchangeRates', p_workspace_id);
  PERFORM public.restore_workspace_recordset('public.import_templates', v_data->'importTemplates', p_workspace_id);
  PERFORM public.restore_workspace_recordset('public.import_sessions', v_data->'importSessions', p_workspace_id);
  PERFORM public.restore_workspace_recordset('public.scheduled_operations', v_data->'scheduledOperations', p_workspace_id);
  PERFORM public.restore_workspace_recordset('public.debts', v_data->'debts', p_workspace_id);
  PERFORM public.restore_workspace_recordset('public.operations', v_data->'operations', p_workspace_id);
  PERFORM public.restore_workspace_recordset('public.operation_allocations', v_data->'operationAllocations', p_workspace_id);
  PERFORM public.restore_workspace_recordset('public.operation_comments', v_data->'operationComments', p_workspace_id);
  PERFORM public.restore_workspace_recordset('public.category_rules', v_data->'categoryRules', p_workspace_id);
  PERFORM public.restore_workspace_recordset('public.cashflow_plans', v_data->'cashflowPlans', p_workspace_id);
  PERFORM public.restore_workspace_recordset('public.budgets', v_data->'budgets', p_workspace_id);
  PERFORM public.restore_workspace_recordset('public.savings_goals', v_data->'savingsGoals', p_workspace_id);
  PERFORM public.restore_workspace_recordset('public.savings_goal_contributions', v_data->'savingsGoalContributions', p_workspace_id);

  v_rows := COALESCE(v_data->'operationTags', '[]'::jsonb);
  IF jsonb_array_length(v_rows) > 0 THEN
    IF EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(v_rows) link(operation_id uuid, tag_id uuid)
      LEFT JOIN public.operations operation ON operation.id = link.operation_id AND operation.workspace_id = p_workspace_id
      LEFT JOIN public.tags tag ON tag.id = link.tag_id AND tag.workspace_id = p_workspace_id
      WHERE operation.id IS NULL OR tag.id IS NULL
    ) THEN RAISE EXCEPTION 'Связь тега указывает на запись другого пространства'; END IF;
    INSERT INTO public.operation_tags(operation_id, tag_id)
    SELECT link.operation_id, link.tag_id
    FROM jsonb_to_recordset(v_rows) link(operation_id uuid, tag_id uuid)
    ON CONFLICT (operation_id, tag_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('dryRun', false, 'restored', true, 'totalRows', v_total, 'counts', v_counts);
END;
$$;

REVOKE ALL ON FUNCTION public.restore_workspace_backup(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_workspace_backup(uuid, jsonb, boolean) TO authenticated, service_role;

COMMIT;
