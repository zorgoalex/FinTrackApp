-- Aggregate arbitrary API date ranges inside Postgres instead of truncating at
-- the PostgREST row limit.

CREATE OR REPLACE FUNCTION public.get_workspace_operation_totals(
  p_workspace_id uuid,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
)
RETURNS TABLE (income numeric, expense numeric, salary numeric, balance numeric)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_workspace_member(auth.uid(), p_workspace_id) THEN
    RAISE EXCEPTION 'Нет доступа к рабочему пространству';
  END IF;
  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from > p_date_to THEN
    RAISE EXCEPTION 'Начальная дата не может быть позже конечной';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(SUM(o.base_amount) FILTER (WHERE o.type = 'income'), 0),
    COALESCE(SUM(o.base_amount) FILTER (WHERE o.type = 'expense'), 0),
    COALESCE(SUM(o.base_amount) FILTER (WHERE o.type = 'salary'), 0),
    COALESCE(SUM(o.base_amount) FILTER (WHERE o.type = 'income'), 0)
      - COALESCE(SUM(o.base_amount) FILTER (WHERE o.type = 'expense'), 0)
      - COALESCE(SUM(o.base_amount) FILTER (WHERE o.type = 'salary'), 0)
  FROM public.operations o
  WHERE o.workspace_id = p_workspace_id
    AND (p_date_from IS NULL OR o.operation_date >= p_date_from)
    AND (p_date_to IS NULL OR o.operation_date <= p_date_to)
    AND o.type IN ('income', 'expense', 'salary');
END;
$$;

REVOKE ALL ON FUNCTION public.get_workspace_operation_totals(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_workspace_operation_totals(uuid, date, date) TO authenticated;
