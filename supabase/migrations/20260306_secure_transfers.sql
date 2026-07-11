-- Secure transfer RPCs and make cross-currency base amounts deterministic.

CREATE OR REPLACE FUNCTION public.create_transfer(
  p_workspace_id uuid,
  p_user_id uuid,
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount numeric,
  p_description text DEFAULT NULL,
  p_operation_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (transfer_group_id uuid, out_operation_id uuid, in_operation_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_group_id uuid := gen_random_uuid();
  v_out_id uuid;
  v_in_id uuid;
  v_from_currency text;
  v_to_currency text;
  v_base_currency text;
  v_base_rate numeric;
  v_base_amount numeric;
BEGIN
  IF auth.role() = 'service_role' THEN
    v_actor_id := p_user_id;
  ELSE
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL OR p_user_id IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'Недопустимый пользователь';
    END IF;
  END IF;

  IF NOT public.user_has_role(v_actor_id, p_workspace_id, ARRAY['Owner', 'Admin', 'Member']) THEN
    RAISE EXCEPTION 'Нет права создавать переводы в этом пространстве';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Сумма должна быть > 0'; END IF;
  IF p_from_account_id = p_to_account_id THEN RAISE EXCEPTION 'Счета должны отличаться'; END IF;

  SELECT currency INTO v_from_currency
  FROM public.accounts
  WHERE id = p_from_account_id AND workspace_id = p_workspace_id AND NOT is_archived;
  IF NOT FOUND THEN RAISE EXCEPTION 'Счёт списания недоступен'; END IF;

  SELECT currency INTO v_to_currency
  FROM public.accounts
  WHERE id = p_to_account_id AND workspace_id = p_workspace_id AND NOT is_archived;
  IF NOT FOUND THEN RAISE EXCEPTION 'Счёт зачисления недоступен'; END IF;

  IF v_from_currency <> v_to_currency THEN
    RAISE EXCEPTION 'Для разных валют используйте create_transfer_v2';
  END IF;

  SELECT base_currency INTO v_base_currency FROM public.workspaces WHERE id = p_workspace_id;
  IF v_from_currency = v_base_currency THEN
    v_base_rate := 1;
  ELSE
    v_base_rate := public.get_exchange_rate(
      p_workspace_id, v_from_currency, v_base_currency,
      COALESCE(p_operation_date, CURRENT_DATE)
    );
    IF v_base_rate IS NULL THEN
      RAISE EXCEPTION 'Нет курса % → % на дату операции', v_from_currency, v_base_currency;
    END IF;
  END IF;
  v_base_amount := round(p_amount * v_base_rate, 2);

  INSERT INTO public.operations (
    workspace_id, user_id, amount, type, description, operation_date,
    account_id, transfer_group_id, transfer_direction,
    currency, exchange_rate, base_amount
  ) VALUES (
    p_workspace_id, v_actor_id, p_amount, 'transfer', p_description,
    COALESCE(p_operation_date, CURRENT_DATE), p_from_account_id, v_group_id, 'out',
    v_from_currency, v_base_rate, v_base_amount
  ) RETURNING id INTO v_out_id;

  INSERT INTO public.operations (
    workspace_id, user_id, amount, type, description, operation_date,
    account_id, transfer_group_id, transfer_direction,
    currency, exchange_rate, base_amount
  ) VALUES (
    p_workspace_id, v_actor_id, p_amount, 'transfer', p_description,
    COALESCE(p_operation_date, CURRENT_DATE), p_to_account_id, v_group_id, 'in',
    v_to_currency, v_base_rate, v_base_amount
  ) RETURNING id INTO v_in_id;

  UPDATE public.operations SET linked_operation_id = v_in_id WHERE id = v_out_id;
  UPDATE public.operations SET linked_operation_id = v_out_id WHERE id = v_in_id;
  RETURN QUERY SELECT v_group_id, v_out_id, v_in_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_transfer_v2(
  p_workspace_id uuid,
  p_user_id uuid,
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_from_amount numeric,
  p_to_amount numeric,
  p_from_currency text DEFAULT 'KZT',
  p_to_currency text DEFAULT 'KZT',
  p_exchange_rate numeric DEFAULT 1.0,
  p_description text DEFAULT NULL,
  p_operation_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (transfer_group_id uuid, out_operation_id uuid, in_operation_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_group_id uuid := gen_random_uuid();
  v_out_id uuid;
  v_in_id uuid;
  v_account_from_currency text;
  v_account_to_currency text;
  v_base_currency text;
  v_out_rate numeric;
  v_in_rate numeric;
  v_out_base_amount numeric;
  v_in_base_amount numeric;
BEGIN
  IF auth.role() = 'service_role' THEN
    v_actor_id := p_user_id;
  ELSE
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL OR p_user_id IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'Недопустимый пользователь';
    END IF;
  END IF;

  IF NOT public.user_has_role(v_actor_id, p_workspace_id, ARRAY['Owner', 'Admin', 'Member']) THEN
    RAISE EXCEPTION 'Нет права создавать переводы в этом пространстве';
  END IF;
  IF p_from_amount IS NULL OR p_from_amount <= 0 THEN RAISE EXCEPTION 'Сумма списания должна быть > 0'; END IF;
  IF p_to_amount IS NULL OR p_to_amount <= 0 THEN RAISE EXCEPTION 'Сумма зачисления должна быть > 0'; END IF;
  IF p_exchange_rate IS NULL OR p_exchange_rate <= 0 THEN RAISE EXCEPTION 'Курс должен быть > 0'; END IF;
  IF p_from_account_id = p_to_account_id THEN RAISE EXCEPTION 'Счета должны отличаться'; END IF;
  IF abs(round(p_from_amount * p_exchange_rate, 2) - p_to_amount) > 0.01 THEN
    RAISE EXCEPTION 'Сумма зачисления не соответствует курсу';
  END IF;

  SELECT currency INTO v_account_from_currency
  FROM public.accounts
  WHERE id = p_from_account_id AND workspace_id = p_workspace_id AND NOT is_archived;
  IF NOT FOUND THEN RAISE EXCEPTION 'Счёт списания недоступен'; END IF;

  SELECT currency INTO v_account_to_currency
  FROM public.accounts
  WHERE id = p_to_account_id AND workspace_id = p_workspace_id AND NOT is_archived;
  IF NOT FOUND THEN RAISE EXCEPTION 'Счёт зачисления недоступен'; END IF;

  IF v_account_from_currency <> p_from_currency OR v_account_to_currency <> p_to_currency THEN
    RAISE EXCEPTION 'Валюты перевода не совпадают с валютами счетов';
  END IF;
  IF v_account_from_currency = v_account_to_currency THEN
    RAISE EXCEPTION 'Для одинаковых валют используйте create_transfer';
  END IF;

  SELECT base_currency INTO v_base_currency FROM public.workspaces WHERE id = p_workspace_id;

  IF v_account_from_currency = v_base_currency THEN
    v_out_base_amount := p_from_amount;
    v_out_rate := 1;
  ELSIF v_account_to_currency = v_base_currency THEN
    v_out_base_amount := p_to_amount;
    v_out_rate := v_out_base_amount / p_from_amount;
  ELSE
    v_out_rate := public.get_exchange_rate(
      p_workspace_id, v_account_from_currency, v_base_currency,
      COALESCE(p_operation_date, CURRENT_DATE)
    );
    IF v_out_rate IS NULL THEN
      RAISE EXCEPTION 'Нет курса % → % на дату операции', v_account_from_currency, v_base_currency;
    END IF;
    v_out_base_amount := round(p_from_amount * v_out_rate, 2);
  END IF;

  IF v_account_to_currency = v_base_currency THEN
    v_in_base_amount := p_to_amount;
    v_in_rate := 1;
  ELSIF v_account_from_currency = v_base_currency THEN
    -- Preserve the workspace total for a transfer involving the base account.
    v_in_base_amount := p_from_amount;
    v_in_rate := v_in_base_amount / p_to_amount;
  ELSE
    v_in_rate := public.get_exchange_rate(
      p_workspace_id, v_account_to_currency, v_base_currency,
      COALESCE(p_operation_date, CURRENT_DATE)
    );
    IF v_in_rate IS NULL THEN
      RAISE EXCEPTION 'Нет курса % → % на дату операции', v_account_to_currency, v_base_currency;
    END IF;
    v_in_base_amount := round(p_to_amount * v_in_rate, 2);
  END IF;

  INSERT INTO public.operations (
    workspace_id, user_id, amount, type, description, operation_date,
    account_id, transfer_group_id, transfer_direction,
    currency, exchange_rate, base_amount
  ) VALUES (
    p_workspace_id, v_actor_id, p_from_amount, 'transfer', p_description,
    COALESCE(p_operation_date, CURRENT_DATE), p_from_account_id, v_group_id, 'out',
    v_account_from_currency, v_out_rate, v_out_base_amount
  ) RETURNING id INTO v_out_id;

  INSERT INTO public.operations (
    workspace_id, user_id, amount, type, description, operation_date,
    account_id, transfer_group_id, transfer_direction,
    currency, exchange_rate, base_amount
  ) VALUES (
    p_workspace_id, v_actor_id, p_to_amount, 'transfer', p_description,
    COALESCE(p_operation_date, CURRENT_DATE), p_to_account_id, v_group_id, 'in',
    v_account_to_currency, v_in_rate, v_in_base_amount
  ) RETURNING id INTO v_in_id;

  UPDATE public.operations SET linked_operation_id = v_in_id WHERE id = v_out_id;
  UPDATE public.operations SET linked_operation_id = v_out_id WHERE id = v_in_id;
  RETURN QUERY SELECT v_group_id, v_out_id, v_in_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_transfer(
  p_workspace_id uuid,
  p_transfer_group_id uuid,
  p_from_account_id uuid DEFAULT NULL,
  p_to_account_id uuid DEFAULT NULL,
  p_amount numeric DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_operation_date date DEFAULT NULL
)
RETURNS TABLE (out_operation_id uuid, in_operation_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_out public.operations%ROWTYPE;
  v_in public.operations%ROWTYPE;
  v_from_account uuid;
  v_to_account uuid;
  v_from_currency text;
  v_to_currency text;
  v_base_currency text;
  v_rate numeric;
  v_new_amount numeric;
  v_new_date date;
BEGIN
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'Требуется авторизация'; END IF;

  SELECT * INTO v_out FROM public.operations
  WHERE workspace_id = p_workspace_id AND transfer_group_id = p_transfer_group_id
    AND type = 'transfer' AND transfer_direction = 'out' FOR UPDATE;
  SELECT * INTO v_in FROM public.operations
  WHERE workspace_id = p_workspace_id AND transfer_group_id = p_transfer_group_id
    AND type = 'transfer' AND transfer_direction = 'in' FOR UPDATE;
  IF v_out.id IS NULL OR v_in.id IS NULL THEN RAISE EXCEPTION 'Перевод не найден'; END IF;

  IF NOT (
    public.user_has_role(v_actor_id, p_workspace_id, ARRAY['Owner', 'Admin'])
    OR (v_out.user_id = v_actor_id AND public.user_has_role(v_actor_id, p_workspace_id, ARRAY['Member']))
  ) THEN
    RAISE EXCEPTION 'Нет права редактировать перевод';
  END IF;

  v_from_account := COALESCE(p_from_account_id, v_out.account_id);
  v_to_account := COALESCE(p_to_account_id, v_in.account_id);
  IF v_from_account = v_to_account THEN RAISE EXCEPTION 'Счета должны отличаться'; END IF;

  SELECT currency INTO v_from_currency FROM public.accounts
  WHERE id = v_from_account AND workspace_id = p_workspace_id AND NOT is_archived;
  IF NOT FOUND THEN RAISE EXCEPTION 'Счёт списания недоступен'; END IF;
  SELECT currency INTO v_to_currency FROM public.accounts
  WHERE id = v_to_account AND workspace_id = p_workspace_id AND NOT is_archived;
  IF NOT FOUND THEN RAISE EXCEPTION 'Счёт зачисления недоступен'; END IF;
  IF v_from_currency <> v_to_currency THEN
    RAISE EXCEPTION 'Редактирование межвалютного перевода пока не поддерживается';
  END IF;

  v_new_amount := COALESCE(p_amount, v_out.amount);
  IF v_new_amount <= 0 THEN RAISE EXCEPTION 'Сумма должна быть > 0'; END IF;
  v_new_date := COALESCE(p_operation_date, v_out.operation_date);
  SELECT base_currency INTO v_base_currency FROM public.workspaces WHERE id = p_workspace_id;
  IF v_from_currency = v_base_currency THEN
    v_rate := 1;
  ELSE
    v_rate := public.get_exchange_rate(p_workspace_id, v_from_currency, v_base_currency, v_new_date);
    IF v_rate IS NULL THEN RAISE EXCEPTION 'Нет курса на дату операции'; END IF;
  END IF;

  UPDATE public.operations SET
    account_id = v_from_account, amount = v_new_amount,
    description = COALESCE(p_description, description), operation_date = v_new_date,
    currency = v_from_currency, exchange_rate = v_rate,
    base_amount = round(v_new_amount * v_rate, 2)
  WHERE id = v_out.id;

  UPDATE public.operations SET
    account_id = v_to_account, amount = v_new_amount,
    description = COALESCE(p_description, description), operation_date = v_new_date,
    currency = v_to_currency, exchange_rate = v_rate,
    base_amount = round(v_new_amount * v_rate, 2)
  WHERE id = v_in.id;

  RETURN QUERY SELECT v_out.id, v_in.id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_transfer(uuid, uuid, uuid, uuid, numeric, text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_transfer_v2(uuid, uuid, uuid, uuid, numeric, numeric, text, text, numeric, text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_transfer(uuid, uuid, uuid, uuid, numeric, text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_transfer(uuid, uuid, uuid, uuid, numeric, text, date) FROM anon;
REVOKE ALL ON FUNCTION public.create_transfer_v2(uuid, uuid, uuid, uuid, numeric, numeric, text, text, numeric, text, date) FROM anon;
REVOKE ALL ON FUNCTION public.update_transfer(uuid, uuid, uuid, uuid, numeric, text, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_transfer(uuid, uuid, uuid, uuid, numeric, text, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_transfer_v2(uuid, uuid, uuid, uuid, numeric, numeric, text, text, numeric, text, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_transfer(uuid, uuid, uuid, uuid, numeric, text, date) TO authenticated;
