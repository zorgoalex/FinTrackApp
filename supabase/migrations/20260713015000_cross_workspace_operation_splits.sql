-- Turn one financial operation into independent parts that can affect different
-- accounts and user-accessible workspaces. The RPC keeps the total exact and
-- performs the entire change in one transaction.

BEGIN;

CREATE TABLE public.operation_split_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_operation_id uuid REFERENCES public.operations(id) ON DELETE SET NULL,
  original_amount numeric(15,2) NOT NULL CHECK (original_amount > 0),
  currency text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.operations
  ADD COLUMN split_group_id uuid REFERENCES public.operation_split_groups(id) ON DELETE SET NULL;

CREATE INDEX operations_split_group_idx
  ON public.operations(split_group_id) WHERE split_group_id IS NOT NULL;

ALTER TABLE public.operation_split_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY operation_split_groups_select ON public.operation_split_groups FOR SELECT
  USING (
    public.is_workspace_member((SELECT auth.uid()), source_workspace_id)
    OR EXISTS (
      SELECT 1 FROM public.operations operation
      WHERE operation.split_group_id = operation_split_groups.id
        AND public.is_workspace_member((SELECT auth.uid()), operation.workspace_id)
    )
  );

REVOKE ALL ON public.operation_split_groups FROM anon, authenticated;
GRANT SELECT ON public.operation_split_groups TO authenticated;

CREATE OR REPLACE FUNCTION public.split_operation(
  p_operation_id uuid,
  p_parts jsonb
)
RETURNS TABLE (operation_id uuid, workspace_id uuid, amount numeric, split_group_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_source public.operations;
  v_source_role text;
  v_item record;
  v_workspace_id uuid;
  v_account_id uuid;
  v_category_id uuid;
  v_counterparty_id uuid;
  v_amount numeric(15,2);
  v_currency text;
  v_base_currency text;
  v_exchange_rate numeric;
  v_base_amount numeric(15,2);
  v_total numeric(15,2) := 0;
  v_count integer;
  v_expected_category_type text;
  v_group_id uuid;
  v_new_operation_id uuid;
  v_tag_names text[];
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Требуется авторизация'; END IF;
  IF p_parts IS NULL OR jsonb_typeof(p_parts) <> 'array' THEN
    RAISE EXCEPTION 'Части операции должны быть JSON-массивом';
  END IF;

  SELECT * INTO v_source FROM public.operations
  WHERE id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Операция не найдена'; END IF;

  v_source_role := public.get_user_role_in_workspace(v_source.workspace_id, v_actor);
  IF COALESCE(v_source_role, '') NOT IN ('Owner', 'Admin')
     AND NOT (COALESCE(v_source_role, '') = 'Member' AND v_source.user_id = v_actor) THEN
    RAISE EXCEPTION 'Недостаточно прав для разделения операции';
  END IF;
  IF v_source.type = 'transfer' THEN
    RAISE EXCEPTION 'Парный перевод нельзя разделить как обычную операцию';
  END IF;
  IF v_source.status = 'reconciled' THEN
    RAISE EXCEPTION 'Сверенную операцию сначала необходимо вернуть на проверку';
  END IF;
  IF v_source.debt_id IS NOT NULL OR v_source.debt_applied_amount IS NOT NULL THEN
    RAISE EXCEPTION 'Сначала отвяжите операцию от долга, затем разделите её';
  END IF;

  v_count := jsonb_array_length(p_parts);
  IF v_count NOT BETWEEN 2 AND 50 THEN
    RAISE EXCEPTION 'Операцию можно разделить на количество частей от 2 до 50';
  END IF;
  v_currency := upper(v_source.currency);
  v_expected_category_type := CASE
    WHEN v_source.type IN ('income', 'personal_salary') THEN 'income'
    ELSE 'expense'
  END;

  CREATE TEMP TABLE pg_temp.fintrack_split_parts (
    position integer PRIMARY KEY,
    workspace_id uuid NOT NULL,
    account_id uuid NOT NULL,
    category_id uuid,
    counterparty_id uuid,
    amount numeric(15,2) NOT NULL,
    exchange_rate numeric NOT NULL,
    base_amount numeric(15,2) NOT NULL
  ) ON COMMIT DROP;

  FOR v_item IN
    SELECT value, (ordinality - 1)::integer AS position
    FROM jsonb_array_elements(p_parts) WITH ORDINALITY
  LOOP
    BEGIN
      v_workspace_id := NULLIF(v_item.value ->> 'workspace_id', '')::uuid;
      v_account_id := NULLIF(v_item.value ->> 'account_id', '')::uuid;
      v_category_id := NULLIF(v_item.value ->> 'category_id', '')::uuid;
      v_counterparty_id := NULLIF(v_item.value ->> 'counterparty_id', '')::uuid;
      v_amount := (v_item.value ->> 'amount')::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Некорректные данные части %', v_item.position + 1;
    END;

    IF v_item.position = 0 AND v_workspace_id IS DISTINCT FROM v_source.workspace_id THEN
      RAISE EXCEPTION 'Первая часть должна остаться в исходном пространстве';
    END IF;
    IF v_workspace_id IS NULL OR v_account_id IS NULL
       OR v_amount IS NULL OR v_amount <= 0 OR v_amount <> round(v_amount, 2) THEN
      RAISE EXCEPTION 'Для части % укажите пространство, счёт и положительную сумму с точностью до 2 знаков', v_item.position + 1;
    END IF;
    IF COALESCE(public.get_user_role_in_workspace(v_workspace_id, v_actor), '') NOT IN ('Owner', 'Admin', 'Member') THEN
      RAISE EXCEPTION 'Недостаточно прав для создания операции в одном из пространств';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.accounts account
      WHERE account.id = v_account_id AND account.workspace_id = v_workspace_id
        AND NOT account.is_archived AND upper(account.currency) = v_currency
    ) THEN
      RAISE EXCEPTION 'Счёт части % недоступен или имеет валюту, отличную от %', v_item.position + 1, v_currency;
    END IF;
    IF v_category_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.categories category
      WHERE category.id = v_category_id AND category.workspace_id = v_workspace_id
        AND NOT category.is_archived AND category.type = v_expected_category_type
    ) THEN
      RAISE EXCEPTION 'Категория части % недоступна или не соответствует типу операции', v_item.position + 1;
    END IF;
    IF v_counterparty_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.counterparties counterparty
      WHERE counterparty.id = v_counterparty_id AND counterparty.workspace_id = v_workspace_id
        AND NOT counterparty.is_archived
    ) THEN
      RAISE EXCEPTION 'Контрагент части % недоступен', v_item.position + 1;
    END IF;

    SELECT workspace.base_currency INTO v_base_currency
    FROM public.workspaces workspace
    WHERE workspace.id = v_workspace_id AND workspace.deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Пространство части % недоступно', v_item.position + 1; END IF;

    IF v_currency = upper(v_base_currency) THEN
      v_exchange_rate := 1;
    ELSE
      v_exchange_rate := public.get_exchange_rate(
        v_workspace_id, v_currency, upper(v_base_currency), v_source.operation_date
      );
      IF v_exchange_rate IS NULL OR v_exchange_rate <= 0 THEN
        RAISE EXCEPTION 'Нет курса % → % для части % на дату операции', v_currency, v_base_currency, v_item.position + 1;
      END IF;
    END IF;
    v_base_amount := round(v_amount * v_exchange_rate, 2);
    IF v_base_amount <= 0 THEN RAISE EXCEPTION 'Базовая сумма части % некорректна', v_item.position + 1; END IF;

    INSERT INTO pg_temp.fintrack_split_parts
      (position, workspace_id, account_id, category_id, counterparty_id, amount, exchange_rate, base_amount)
    VALUES
      (v_item.position, v_workspace_id, v_account_id, v_category_id, v_counterparty_id, v_amount, v_exchange_rate, v_base_amount);
    v_total := v_total + v_amount;
  END LOOP;

  IF v_total <> v_source.amount THEN
    RAISE EXCEPTION 'Сумма частей (%) должна точно совпадать с суммой операции (%)', v_total, v_source.amount;
  END IF;

  SELECT COALESCE(array_agg(tag.name ORDER BY tag.name), '{}'::text[])
  INTO v_tag_names
  FROM public.operation_tags operation_tag
  JOIN public.tags tag ON tag.id = operation_tag.tag_id
  WHERE operation_tag.operation_id = v_source.id;

  INSERT INTO public.operation_split_groups (
    source_workspace_id, source_operation_id, original_amount, currency, created_by
  ) VALUES (
    v_source.workspace_id, v_source.id, v_source.amount, v_currency, v_actor
  ) RETURNING id INTO v_group_id;

  -- Existing analytical allocations cannot survive a physical amount change.
  DELETE FROM public.operation_allocations WHERE operation_id = v_source.id;
  PERFORM set_config('fintrack.status_transition', 'on', true);

  FOR v_item IN SELECT * FROM pg_temp.fintrack_split_parts ORDER BY position LOOP
    IF v_item.position = 0 THEN
      UPDATE public.operations SET
        amount = v_item.amount,
        base_amount = v_item.base_amount,
        exchange_rate = v_item.exchange_rate,
        account_id = v_item.account_id,
        category_id = v_item.category_id,
        counterparty_id = v_item.counterparty_id,
        split_group_id = v_group_id,
        status = 'new',
        verified_at = NULL,
        verified_by = NULL,
        reconciled_at = NULL,
        reconciled_by = NULL
      WHERE id = v_source.id;
      v_new_operation_id := v_source.id;

      IF v_source.status = 'verified' THEN
        INSERT INTO public.operation_status_events (
          workspace_id, operation_id, from_status, to_status, actor_id, reason
        ) VALUES (
          v_source.workspace_id, v_source.id, 'verified', 'new', v_actor,
          'Операция физически разделена на несколько частей'
        );
      END IF;
    ELSE
      INSERT INTO public.operations (
        workspace_id, user_id, amount, type, description, operation_date,
        category_id, counterparty_id, account_id, currency, exchange_rate,
        base_amount, status, split_group_id
      ) VALUES (
        v_item.workspace_id, v_actor, v_item.amount, v_source.type,
        v_source.description, v_source.operation_date, v_item.category_id,
        v_item.counterparty_id, v_item.account_id, v_currency,
        v_item.exchange_rate, v_item.base_amount, 'new', v_group_id
      ) RETURNING id INTO v_new_operation_id;

      INSERT INTO public.operation_status_events (
        workspace_id, operation_id, from_status, to_status, actor_id, reason
      ) VALUES (
        v_item.workspace_id, v_new_operation_id, NULL, 'new', v_actor,
        'Создано при физическом разделении операции'
      );

      IF cardinality(v_tag_names) > 0 THEN
        INSERT INTO public.tags(workspace_id, name, color, is_archived)
        SELECT v_item.workspace_id, name, '#6B7280', false FROM unnest(v_tag_names) name
        ON CONFLICT (workspace_id, name) DO UPDATE SET is_archived = false;
        INSERT INTO public.operation_tags(operation_id, tag_id)
        SELECT v_new_operation_id, tag.id FROM public.tags tag
        WHERE tag.workspace_id = v_item.workspace_id AND tag.name = ANY(v_tag_names)
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;

    operation_id := v_new_operation_id;
    workspace_id := v_item.workspace_id;
    amount := v_item.amount;
    split_group_id := v_group_id;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.split_operation(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.split_operation(uuid, jsonb) TO authenticated;

COMMIT;
