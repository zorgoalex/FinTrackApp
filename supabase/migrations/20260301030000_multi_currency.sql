-- =====================================
-- Multi-currency support
-- =====================================

BEGIN;

-- ==================
-- 1. Reference table: currencies (ISO 4217)
-- ==================
CREATE TABLE IF NOT EXISTS public.currencies (
  code text PRIMARY KEY CHECK (length(code) = 3),
  name_ru text NOT NULL,
  name_en text NOT NULL,
  symbol text NOT NULL,
  decimal_digits smallint NOT NULL DEFAULT 2,
  is_active boolean NOT NULL DEFAULT true
);

-- Seed currencies
INSERT INTO public.currencies (code, name_ru, name_en, symbol, decimal_digits) VALUES
  ('RUB', 'Российский рубль', 'Russian Ruble', '₽', 2),
  ('USD', 'Доллар США', 'US Dollar', '$', 2),
  ('EUR', 'Евро', 'Euro', '€', 2),
  ('GBP', 'Фунт стерлингов', 'British Pound', '£', 2),
  ('CNY', 'Китайский юань', 'Chinese Yuan', '¥', 2),
  ('JPY', 'Японская иена', 'Japanese Yen', '¥', 0),
  ('TRY', 'Турецкая лира', 'Turkish Lira', '₺', 2),
  ('GEL', 'Грузинский лари', 'Georgian Lari', '₾', 2),
  ('KZT', 'Казахстанский тенге', 'Kazakhstani Tenge', '₸', 2),
  ('BYN', 'Белорусский рубль', 'Belarusian Ruble', 'Br', 2),
  ('UAH', 'Украинская гривна', 'Ukrainian Hryvnia', '₴', 2),
  ('AED', 'Дирхам ОАЭ', 'UAE Dirham', 'د.إ', 2),
  ('THB', 'Тайский бат', 'Thai Baht', '฿', 2),
  ('ILS', 'Израильский шекель', 'Israeli Shekel', '₪', 2),
  ('AMD', 'Армянский драм', 'Armenian Dram', '֏', 2),
  ('UZS', 'Узбекский сум', 'Uzbekistani Som', 'сўм', 2),
  ('AZN', 'Азербайджанский манат', 'Azerbaijani Manat', '₼', 2),
  ('KGS', 'Киргизский сом', 'Kyrgyzstani Som', 'сом', 2),
  ('TJS', 'Таджикский сомони', 'Tajikistani Somoni', 'SM', 2),
  ('MDL', 'Молдавский лей', 'Moldovan Leu', 'L', 2),
  ('PLN', 'Польский злотый', 'Polish Zloty', 'zł', 2),
  ('CZK', 'Чешская крона', 'Czech Koruna', 'Kč', 2),
  ('CHF', 'Швейцарский франк', 'Swiss Franc', 'CHF', 2),
  ('CAD', 'Канадский доллар', 'Canadian Dollar', 'C$', 2),
  ('AUD', 'Австралийский доллар', 'Australian Dollar', 'A$', 2),
  ('SGD', 'Сингапурский доллар', 'Singapore Dollar', 'S$', 2),
  ('HKD', 'Гонконгский доллар', 'Hong Kong Dollar', 'HK$', 2),
  ('INR', 'Индийская рупия', 'Indian Rupee', '₹', 2),
  ('BRL', 'Бразильский реал', 'Brazilian Real', 'R$', 2),
  ('KRW', 'Южнокорейская вона', 'South Korean Won', '₩', 0)
ON CONFLICT (code) DO NOTHING;

-- Public read access (no RLS restrictions for SELECT)
ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "currencies_public_read" ON public.currencies FOR SELECT USING (true);

-- ==================
-- 2. Exchange rates per workspace
-- ==================
CREATE TABLE IF NOT EXISTS public.exchange_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  from_currency text NOT NULL REFERENCES public.currencies(code),
  to_currency text NOT NULL REFERENCES public.currencies(code),
  rate numeric(20,10) NOT NULL CHECK (rate > 0),
  rate_date date NOT NULL DEFAULT CURRENT_DATE,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exchange_rates_diff_currencies CHECK (from_currency <> to_currency)
);

-- One rate per workspace + pair + date
CREATE UNIQUE INDEX uq_exchange_rates_ws_pair_date
  ON public.exchange_rates(workspace_id, from_currency, to_currency, rate_date);

-- Fast lookup: latest rate
CREATE INDEX idx_exchange_rates_lookup
  ON public.exchange_rates(workspace_id, from_currency, to_currency, rate_date DESC);

-- RLS
ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "exchange_rates_select" ON public.exchange_rates FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = exchange_rates.workspace_id
      AND wm.user_id = auth.uid() AND wm.is_active = true
  ));

CREATE POLICY "exchange_rates_insert" ON public.exchange_rates FOR INSERT
  WITH CHECK (user_has_role(auth.uid(), workspace_id, ARRAY['Owner'::text, 'Admin'::text]));

CREATE POLICY "exchange_rates_update" ON public.exchange_rates FOR UPDATE
  USING (user_has_role(auth.uid(), workspace_id, ARRAY['Owner'::text, 'Admin'::text]))
  WITH CHECK (user_has_role(auth.uid(), workspace_id, ARRAY['Owner'::text, 'Admin'::text]));

CREATE POLICY "exchange_rates_delete" ON public.exchange_rates FOR DELETE
  USING (user_has_role(auth.uid(), workspace_id, ARRAY['Owner'::text, 'Admin'::text]));

-- ==================
-- 3. ALTER workspaces: base currency + auto fetch
-- ==================
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS base_currency text NOT NULL DEFAULT 'RUB',
  ADD COLUMN IF NOT EXISTS auto_fetch_rates boolean NOT NULL DEFAULT false;

-- FK added separately (table may already exist before currencies)
DO $$ BEGIN
  ALTER TABLE public.workspaces
    ADD CONSTRAINT fk_workspaces_base_currency
    FOREIGN KEY (base_currency) REFERENCES public.currencies(code);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ==================
-- 4. ALTER accounts: currency
-- ==================
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'RUB';

DO $$ BEGIN
  ALTER TABLE public.accounts
    ADD CONSTRAINT fk_accounts_currency
    FOREIGN KEY (currency) REFERENCES public.currencies(code);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ==================
-- 5. ALTER operations: currency, exchange_rate, base_amount
-- ==================
ALTER TABLE public.operations
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'RUB',
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(20,10) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS base_amount numeric(15,2) DEFAULT NULL;

DO $$ BEGIN
  ALTER TABLE public.operations
    ADD CONSTRAINT fk_operations_currency
    FOREIGN KEY (currency) REFERENCES public.currencies(code);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Backfill: all existing operations are RUB
UPDATE public.operations SET
  currency = 'RUB',
  exchange_rate = 1.0,
  base_amount = amount
WHERE base_amount IS NULL;

-- Now make base_amount NOT NULL
ALTER TABLE public.operations ALTER COLUMN base_amount SET NOT NULL;

-- ==================
-- 6. ALTER debts: currency
-- ==================
ALTER TABLE public.debts
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'RUB';

DO $$ BEGIN
  ALTER TABLE public.debts
    ADD CONSTRAINT fk_debts_currency
    FOREIGN KEY (currency) REFERENCES public.currencies(code);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ==================
-- 7. ALTER scheduled_operations: currency
-- ==================
ALTER TABLE public.scheduled_operations
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'RUB';

DO $$ BEGIN
  ALTER TABLE public.scheduled_operations
    ADD CONSTRAINT fk_scheduled_operations_currency
    FOREIGN KEY (currency) REFERENCES public.currencies(code);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ==================
-- 8. RPC: get_exchange_rate (lookup with fallback)
-- ==================
CREATE OR REPLACE FUNCTION public.get_exchange_rate(
  p_workspace_id uuid,
  p_from_currency text,
  p_to_currency text,
  p_date date DEFAULT CURRENT_DATE
)
RETURNS numeric(20,10)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_rate numeric(20,10);
BEGIN
  -- Same currency
  IF p_from_currency = p_to_currency THEN RETURN 1.0; END IF;

  -- Direct rate: closest date <= p_date
  SELECT rate INTO v_rate
  FROM public.exchange_rates
  WHERE workspace_id = p_workspace_id
    AND from_currency = p_from_currency
    AND to_currency = p_to_currency
    AND rate_date <= p_date
  ORDER BY rate_date DESC
  LIMIT 1;
  IF v_rate IS NOT NULL THEN RETURN v_rate; END IF;

  -- Reverse rate
  SELECT 1.0 / rate INTO v_rate
  FROM public.exchange_rates
  WHERE workspace_id = p_workspace_id
    AND from_currency = p_to_currency
    AND to_currency = p_from_currency
    AND rate_date <= p_date
  ORDER BY rate_date DESC
  LIMIT 1;
  IF v_rate IS NOT NULL THEN RETURN v_rate; END IF;

  -- Fallback: latest direct regardless of date
  SELECT rate INTO v_rate
  FROM public.exchange_rates
  WHERE workspace_id = p_workspace_id
    AND from_currency = p_from_currency
    AND to_currency = p_to_currency
  ORDER BY rate_date DESC
  LIMIT 1;
  IF v_rate IS NOT NULL THEN RETURN v_rate; END IF;

  -- Fallback: latest reverse regardless of date
  SELECT 1.0 / rate INTO v_rate
  FROM public.exchange_rates
  WHERE workspace_id = p_workspace_id
    AND from_currency = p_to_currency
    AND to_currency = p_from_currency
  ORDER BY rate_date DESC
  LIMIT 1;

  RETURN v_rate; -- NULL if no rate found
END; $$;

GRANT EXECUTE ON FUNCTION public.get_exchange_rate(uuid, text, text, date) TO authenticated;

-- ==================
-- 9. Updated RPC: get_account_balances (now returns currency + base_balance)
-- Must DROP old signature first since return type changed
-- ==================
DROP FUNCTION IF EXISTS public.get_account_balances(uuid);
CREATE OR REPLACE FUNCTION public.get_account_balances(p_workspace_id uuid)
RETURNS TABLE (account_id uuid, currency text, balance numeric, base_balance numeric)
LANGUAGE sql STABLE AS $$
  SELECT
    a.id AS account_id,
    a.currency,
    COALESCE(SUM(CASE
      WHEN o.type IN ('income', 'salary') THEN o.amount
      WHEN o.type = 'transfer' AND o.transfer_direction = 'in' THEN o.amount
      ELSE -o.amount
    END), 0)::numeric AS balance,
    COALESCE(SUM(CASE
      WHEN o.type IN ('income', 'salary') THEN o.base_amount
      WHEN o.type = 'transfer' AND o.transfer_direction = 'in' THEN o.base_amount
      ELSE -o.base_amount
    END), 0)::numeric AS base_balance
  FROM public.accounts a
  LEFT JOIN public.operations o ON o.account_id = a.id AND o.workspace_id = p_workspace_id
  WHERE a.workspace_id = p_workspace_id AND NOT a.is_archived
  GROUP BY a.id, a.currency;
$$;

-- Grant already exists from previous migration, but re-grant just in case
GRANT EXECUTE ON FUNCTION public.get_account_balances(uuid) TO authenticated;

-- ==================
-- 10. New RPC: create_transfer_v2 (cross-currency support)
-- ==================
CREATE OR REPLACE FUNCTION public.create_transfer_v2(
  p_workspace_id uuid,
  p_user_id uuid,
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_from_amount numeric,
  p_to_amount numeric,
  p_from_currency text DEFAULT 'RUB',
  p_to_currency text DEFAULT 'RUB',
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

GRANT EXECUTE ON FUNCTION public.create_transfer_v2(uuid, uuid, uuid, uuid, numeric, numeric, text, text, numeric, text, date) TO authenticated;

-- ==================
-- 11. Updated RPC: get_debts_with_balance (add currency column)
-- Must DROP old signature first since return type changed
-- ==================
DROP FUNCTION IF EXISTS public.get_debts_with_balance(uuid);
CREATE OR REPLACE FUNCTION public.get_debts_with_balance(p_workspace_id uuid)
RETURNS TABLE (
  id uuid,
  workspace_id uuid,
  created_by uuid,
  title text,
  counterparty text,
  direction text,
  initial_amount numeric,
  paid_amount numeric,
  remaining_amount numeric,
  progress_pct numeric,
  opened_on date,
  due_on date,
  notes text,
  is_archived boolean,
  created_at timestamptz,
  updated_at timestamptz,
  currency text
)
LANGUAGE sql STABLE AS $$
  WITH paid AS (
    SELECT
      o.debt_id,
      COALESCE(SUM(o.debt_applied_amount), 0)::numeric AS paid_amount
    FROM public.operations o
    WHERE o.workspace_id = p_workspace_id
      AND o.debt_id IS NOT NULL
    GROUP BY o.debt_id
  )
  SELECT
    d.id,
    d.workspace_id,
    d.created_by,
    d.title,
    d.counterparty,
    d.direction,
    d.initial_amount,
    COALESCE(p.paid_amount, 0)::numeric AS paid_amount,
    GREATEST(d.initial_amount - COALESCE(p.paid_amount, 0), 0)::numeric AS remaining_amount,
    CASE
      WHEN d.initial_amount = 0 THEN 100
      ELSE ROUND(LEAST(COALESCE(p.paid_amount, 0) / d.initial_amount, 1) * 100, 2)
    END::numeric AS progress_pct,
    d.opened_on,
    d.due_on,
    d.notes,
    d.is_archived,
    d.created_at,
    d.updated_at,
    d.currency
  FROM public.debts d
  LEFT JOIN paid p ON p.debt_id = d.id
  WHERE d.workspace_id = p_workspace_id
  ORDER BY d.is_archived ASC, remaining_amount DESC, d.updated_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_debts_with_balance(uuid) TO authenticated;

COMMIT;
