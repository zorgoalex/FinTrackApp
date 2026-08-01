-- Fix the production split_operation RPC without rewriting the already-applied
-- migration that originally introduced it. The RETURNS TABLE output variable
-- `operation_id` conflicts with operation_allocations.operation_id unless the
-- table column is explicitly qualified.

DO $migration$
DECLARE
  v_definition text;
  v_fixed_definition text;
BEGIN
  SELECT pg_get_functiondef('public.split_operation(uuid,jsonb)'::regprocedure)
  INTO v_definition;

  v_fixed_definition := replace(
    v_definition,
    'DELETE FROM public.operation_allocations WHERE operation_id = v_source.id;',
    'DELETE FROM public.operation_allocations AS allocation WHERE allocation.operation_id = v_source.id;'
  );

  IF v_fixed_definition = v_definition THEN
    RAISE EXCEPTION 'split_operation definition did not contain the expected ambiguous DELETE statement';
  END IF;

  -- RETURNS TABLE creates PL/pgSQL variables named operation_id,
  -- workspace_id, amount and split_group_id. Prefer table columns anywhere an
  -- SQL statement could otherwise match both meanings. Direct assignments to
  -- the output variables remain unchanged.
  v_fixed_definition := replace(
    v_fixed_definition,
    E'AS $function$\nDECLARE',
    E'AS $function$\n#variable_conflict use_column\nDECLARE'
  );

  IF position(E'#variable_conflict use_column\nDECLARE' IN v_fixed_definition) = 0 THEN
    RAISE EXCEPTION 'split_operation definition did not contain the expected PL/pgSQL body marker';
  END IF;

  -- The RPC can be called more than once in one transaction (including from
  -- pgTAP). ON COMMIT DROP is not enough in that case, so recreate the scratch
  -- table at the start of every invocation.
  v_fixed_definition := replace(
    v_fixed_definition,
    '  CREATE TEMP TABLE pg_temp.fintrack_split_parts (',
    E'  DROP TABLE IF EXISTS pg_temp.fintrack_split_parts;\n  CREATE TEMP TABLE pg_temp.fintrack_split_parts ('
  );

  IF position('DROP TABLE IF EXISTS pg_temp.fintrack_split_parts' IN v_fixed_definition) = 0 THEN
    RAISE EXCEPTION 'split_operation definition did not contain the expected temporary table statement';
  END IF;

  EXECUTE v_fixed_definition;
END;
$migration$;
