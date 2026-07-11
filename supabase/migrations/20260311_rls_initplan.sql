-- Evaluate JWT helpers once per statement instead of once per candidate row.
-- This keeps RLS predictable as operations and memberships grow.

DO $$
DECLARE
  v_policy record;
  v_using text;
  v_check text;
  v_sql text;
BEGIN
  FOR v_policy IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    v_using := v_policy.qual;
    v_check := v_policy.with_check;

    IF v_using IS NOT NULL THEN
      v_using := replace(v_using, 'auth.uid()', '(SELECT auth.uid())');
      v_using := replace(v_using, 'auth.jwt()', '(SELECT auth.jwt())');
    END IF;
    IF v_check IS NOT NULL THEN
      v_check := replace(v_check, 'auth.uid()', '(SELECT auth.uid())');
      v_check := replace(v_check, 'auth.jwt()', '(SELECT auth.jwt())');
    END IF;

    IF v_using IS DISTINCT FROM v_policy.qual OR v_check IS DISTINCT FROM v_policy.with_check THEN
      v_sql := format(
        'ALTER POLICY %I ON %I.%I',
        v_policy.policyname,
        v_policy.schemaname,
        v_policy.tablename
      );
      IF v_using IS NOT NULL THEN
        v_sql := v_sql || format(' USING (%s)', v_using);
      END IF;
      IF v_check IS NOT NULL THEN
        v_sql := v_sql || format(' WITH CHECK (%s)', v_check);
      END IF;
      EXECUTE v_sql;
    END IF;
  END LOOP;
END;
$$;
