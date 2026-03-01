-- Migration: Change default currency from RUB to KZT
-- Date: 2026-03-01
-- Description: Updates all DEFAULT values for currency columns from 'RUB' to 'KZT'.
--              Fixes create_transfer (v1) to explicitly read currency from accounts.
--              Updates create_transfer_v2 default parameters.
--              Existing data is NOT modified — only defaults for new records.

-- ==========================================
-- 1. ALTER DEFAULT for 5 tables
-- ==========================================

ALTER TABLE public.workspaces ALTER COLUMN base_currency SET DEFAULT 'KZT';
ALTER TABLE public.accounts ALTER COLUMN currency SET DEFAULT 'KZT';
ALTER TABLE public.operations ALTER COLUMN currency SET DEFAULT 'KZT';
ALTER TABLE public.debts ALTER COLUMN currency SET DEFAULT 'KZT';
ALTER TABLE public.scheduled_operations ALTER COLUMN currency SET DEFAULT 'KZT';

-- ==========================================
-- 2. Fix create_transfer (v1) — explicit currency from accounts
-- ==========================================
-- Risk: v1 inserts into operations WITHOUT specifying currency/base_amount,
-- relying on DB DEFAULT. After changing default to KZT, transfers in RUB
-- workspaces would incorrectly get currency='KZT'.
-- Fix: Read currency from each account, reject cross-currency (use v2 for that),
-- compute base_amount explicitly.

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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_group_id uuid := gen_random_uuid();
  v_out_id uuid;
  v_in_id uuid;
  v_from_currency text;
  v_to_currency text;
  v_ws_base text;
  v_base_amount numeric;
  v_rate numeric;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Сумма должна быть > 0'; END IF;
  IF p_from_account_id = p_to_account_id THEN RAISE EXCEPTION 'Счета должны отличаться'; END IF;

  -- Validate accounts exist and read their currencies
  SELECT currency INTO v_from_currency FROM public.accounts WHERE id = p_from_account_id AND workspace_id = p_workspace_id AND NOT is_archived;
  IF NOT FOUND THEN RAISE EXCEPTION 'Счёт списания недоступен'; END IF;

  SELECT currency INTO v_to_currency FROM public.accounts WHERE id = p_to_account_id AND workspace_id = p_workspace_id AND NOT is_archived;
  IF NOT FOUND THEN RAISE EXCEPTION 'Счёт зачисления недоступен'; END IF;

  -- v1 does not support cross-currency transfers (single amount param)
  IF v_from_currency <> v_to_currency THEN
    RAISE EXCEPTION 'Разные валюты счетов — используйте create_transfer_v2';
  END IF;

  -- Read workspace base currency for base_amount computation
  SELECT base_currency INTO v_ws_base FROM public.workspaces WHERE id = p_workspace_id;

  -- Compute base_amount
  IF v_from_currency = v_ws_base THEN
    v_base_amount := p_amount;
    v_rate := 1.0;
  ELSE
    v_rate := get_exchange_rate(p_workspace_id, v_from_currency, v_ws_base, COALESCE(p_operation_date, CURRENT_DATE));
    v_base_amount := ROUND(p_amount * COALESCE(v_rate, 1.0), 2);
  END IF;

  -- OUT leg
  INSERT INTO public.operations (workspace_id, user_id, amount, type, description, operation_date, account_id, transfer_group_id, transfer_direction, currency, exchange_rate, base_amount)
  VALUES (p_workspace_id, p_user_id, p_amount, 'transfer', p_description, COALESCE(p_operation_date, CURRENT_DATE), p_from_account_id, v_group_id, 'out', v_from_currency, v_rate, v_base_amount)
  RETURNING id INTO v_out_id;

  -- IN leg
  INSERT INTO public.operations (workspace_id, user_id, amount, type, description, operation_date, account_id, transfer_group_id, transfer_direction, currency, exchange_rate, base_amount)
  VALUES (p_workspace_id, p_user_id, p_amount, 'transfer', p_description, COALESCE(p_operation_date, CURRENT_DATE), p_to_account_id, v_group_id, 'in', v_from_currency, v_rate, v_base_amount)
  RETURNING id INTO v_in_id;

  UPDATE public.operations SET linked_operation_id = v_in_id WHERE id = v_out_id;
  UPDATE public.operations SET linked_operation_id = v_out_id WHERE id = v_in_id;

  RETURN QUERY SELECT v_group_id, v_out_id, v_in_id;
END; $$;

-- ==========================================
-- 3. Fix create_transfer_v2 — update default parameters
-- ==========================================

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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_group_id uuid := gen_random_uuid();
  v_out_id uuid;
  v_in_id uuid;
  v_ws_base text;
  v_out_base_amount numeric;
  v_in_base_amount numeric;
BEGIN
  IF p_from_amount IS NULL OR p_from_amount <= 0 THEN RAISE EXCEPTION 'Сумма списания должна быть > 0'; END IF;
  IF p_to_amount IS NULL OR p_to_amount <= 0 THEN RAISE EXCEPTION 'Сумма зачисления должна быть > 0'; END IF;
  IF p_from_account_id = p_to_account_id THEN RAISE EXCEPTION 'Счета должны отличаться'; END IF;

  PERFORM 1 FROM public.accounts WHERE id = p_from_account_id AND workspace_id = p_workspace_id AND NOT is_archived;
  IF NOT FOUND THEN RAISE EXCEPTION 'Счёт списания недоступен'; END IF;
  PERFORM 1 FROM public.accounts WHERE id = p_to_account_id AND workspace_id = p_workspace_id AND NOT is_archived;
  IF NOT FOUND THEN RAISE EXCEPTION 'Счёт зачисления недоступен'; END IF;

  -- Get workspace base currency for base_amount computation
  SELECT base_currency INTO v_ws_base FROM public.workspaces WHERE id = p_workspace_id;

  -- Compute base_amount for each leg
  IF p_from_currency = v_ws_base THEN
    v_out_base_amount := p_from_amount;
  ELSE
    v_out_base_amount := ROUND(p_from_amount * COALESCE(
      get_exchange_rate(p_workspace_id, p_from_currency, v_ws_base, COALESCE(p_operation_date, CURRENT_DATE)),
      p_exchange_rate
    ), 2);
  END IF;

  IF p_to_currency = v_ws_base THEN
    v_in_base_amount := p_to_amount;
  ELSE
    v_in_base_amount := ROUND(p_to_amount * COALESCE(
      get_exchange_rate(p_workspace_id, p_to_currency, v_ws_base, COALESCE(p_operation_date, CURRENT_DATE)),
      p_exchange_rate
    ), 2);
  END IF;

  INSERT INTO public.operations (workspace_id, user_id, amount, type, description, operation_date, account_id, transfer_group_id, transfer_direction, currency, exchange_rate, base_amount)
  VALUES (p_workspace_id, p_user_id, p_from_amount, 'transfer', p_description, COALESCE(p_operation_date, CURRENT_DATE), p_from_account_id, v_group_id, 'out', p_from_currency, p_exchange_rate, v_out_base_amount)
  RETURNING id INTO v_out_id;

  INSERT INTO public.operations (workspace_id, user_id, amount, type, description, operation_date, account_id, transfer_group_id, transfer_direction, currency, exchange_rate, base_amount)
  VALUES (p_workspace_id, p_user_id, p_to_amount, 'transfer', p_description, COALESCE(p_operation_date, CURRENT_DATE), p_to_account_id, v_group_id, 'in', p_to_currency, p_exchange_rate, v_in_base_amount)
  RETURNING id INTO v_in_id;

  UPDATE public.operations SET linked_operation_id = v_in_id WHERE id = v_out_id;
  UPDATE public.operations SET linked_operation_id = v_out_id WHERE id = v_in_id;

  RETURN QUERY SELECT v_group_id, v_out_id, v_in_id;
END; $$;

-- Grant execute (re-grant in case signature changed)
GRANT EXECUTE ON FUNCTION public.create_transfer(uuid, uuid, uuid, uuid, numeric, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_transfer_v2(uuid, uuid, uuid, uuid, numeric, numeric, text, text, numeric, text, date) TO authenticated;
