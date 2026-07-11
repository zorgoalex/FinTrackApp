-- Server-side dashboard totals stay correct even when operation lists are paginated.

CREATE OR REPLACE FUNCTION public.get_workspace_operation_summary(
  p_workspace_id uuid,
  p_today date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  period text,
  income numeric,
  expense numeric,
  salary numeric,
  total numeric
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_workspace_member(auth.uid(), p_workspace_id) THEN
    RAISE EXCEPTION 'Нет доступа к рабочему пространству';
  END IF;

  RETURN QUERY
  WITH periods AS (
    SELECT 'today'::text AS period_name, p_today AS date_from, p_today AS date_to
    UNION ALL
    SELECT
      'month'::text,
      date_trunc('month', p_today)::date,
      (date_trunc('month', p_today) + interval '1 month - 1 day')::date
  ), totals AS (
    SELECT
      p.period_name,
      COALESCE(SUM(o.base_amount) FILTER (WHERE o.type = 'income'), 0) AS income,
      COALESCE(SUM(o.base_amount) FILTER (WHERE o.type = 'expense'), 0) AS expense,
      COALESCE(SUM(o.base_amount) FILTER (WHERE o.type = 'salary'), 0) AS salary
    FROM periods p
    LEFT JOIN public.operations o
      ON o.workspace_id = p_workspace_id
     AND o.operation_date BETWEEN p.date_from AND p.date_to
     AND o.type IN ('income', 'expense', 'salary')
    GROUP BY p.period_name
  )
  SELECT
    t.period_name,
    t.income,
    t.expense,
    t.salary,
    t.income - t.expense - t.salary
  FROM totals t
  ORDER BY CASE t.period_name WHEN 'today' THEN 1 ELSE 2 END;
END;
$$;

REVOKE ALL ON FUNCTION public.get_workspace_operation_summary(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_workspace_operation_summary(uuid, date) TO authenticated;
