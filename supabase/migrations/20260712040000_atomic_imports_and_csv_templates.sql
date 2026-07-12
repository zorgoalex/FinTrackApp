-- Atomic, race-safe document imports and reusable CSV column mappings.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_valid_import_mapping(p_mapping jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT jsonb_typeof(p_mapping) = 'object'
    AND octet_length(p_mapping::text) <= 16384
    AND p_mapping ? 'date'
    AND (
      p_mapping ? 'amount'
      OR (p_mapping ? 'debit' AND p_mapping ? 'credit')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_each(p_mapping) entry
      WHERE entry.key <> ALL (ARRAY[
        'date', 'type', 'amount', 'debit', 'credit', 'currency', 'rate', 'baseAmount',
        'account', 'category', 'counterparty', 'description', 'reference', 'tags'
      ])
      OR jsonb_typeof(entry.value) NOT IN ('string', 'number')
      OR (jsonb_typeof(entry.value) = 'string' AND char_length(entry.value #>> '{}') > 200)
      OR (jsonb_typeof(entry.value) = 'number' AND (entry.value #>> '{}')::numeric < 0)
    );
$$;

CREATE TABLE public.import_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  mapping jsonb NOT NULL CHECK (public.is_valid_import_mapping(mapping)),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(settings) = 'object' AND octet_length(settings::text) <= 4096
  ),
  is_archived boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_templates_id_workspace_unique UNIQUE (id, workspace_id)
);

CREATE UNIQUE INDEX import_templates_workspace_active_name_key
  ON public.import_templates(workspace_id, lower(btrim(name)))
  WHERE NOT is_archived;
CREATE INDEX import_templates_workspace_updated_idx
  ON public.import_templates(workspace_id, is_archived, updated_at DESC);

CREATE TRIGGER update_import_templates_updated_at
  BEFORE UPDATE ON public.import_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.protect_import_template_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Системные реквизиты шаблона импорта нельзя изменять';
  END IF;
  NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by, OLD.updated_by);
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_import_template_identity
  BEFORE UPDATE ON public.import_templates
  FOR EACH ROW EXECUTE FUNCTION public.protect_import_template_identity();

ALTER TABLE public.import_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY import_templates_select ON public.import_templates FOR SELECT
  USING (public.is_workspace_member((SELECT auth.uid()), workspace_id));
CREATE POLICY import_templates_insert ON public.import_templates FOR INSERT
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND public.user_has_role(
      (SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin', 'Member']
    )
  );
CREATE POLICY import_templates_update ON public.import_templates FOR UPDATE
  USING (public.user_has_role(
    (SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin', 'Member']
  ))
  WITH CHECK (public.user_has_role(
    (SELECT auth.uid()), workspace_id, ARRAY['Owner', 'Admin', 'Member']
  ));

GRANT SELECT, INSERT, UPDATE ON public.import_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_templates TO service_role;

ALTER TABLE public.import_sessions
  ADD COLUMN request_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN template_id uuid,
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN result jsonb;

ALTER TABLE public.import_sessions
  ADD CONSTRAINT import_sessions_workspace_request_unique
    UNIQUE (workspace_id, created_by, request_id),
  ADD CONSTRAINT import_sessions_template_workspace_fkey
    FOREIGN KEY (template_id, workspace_id)
    REFERENCES public.import_templates(id, workspace_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT import_sessions_metadata_check CHECK (
    jsonb_typeof(metadata) = 'object'
    AND octet_length(metadata::text) <= 4096
    AND NOT jsonb_path_exists(
      metadata,
      '$.keyvalue().key ? (@ == "filename" || @ == "file_name" || @ == "raw_text" || @ == "ocr_text" || @ == "iban" || @ == "account_number" || @ == "card_number" || @ == "email" || @ == "phone")'
    )
  ),
  ADD CONSTRAINT import_sessions_result_check CHECK (
    result IS NULL OR (jsonb_typeof(result) = 'object' AND octet_length(result::text) <= 131072)
  );

DROP POLICY IF EXISTS import_sessions_update ON public.import_sessions;
REVOKE UPDATE, DELETE ON public.import_sessions FROM authenticated;

CREATE OR REPLACE FUNCTION public.block_direct_import_session_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Сессии импорта неизменяемы; используйте confirm_import';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER block_direct_import_session_mutation
  BEFORE UPDATE OR DELETE ON public.import_sessions
  FOR EACH ROW EXECUTE FUNCTION public.block_direct_import_session_mutation();

CREATE OR REPLACE FUNCTION public.confirm_import(
  p_workspace_id uuid,
  p_source_kind text,
  p_bank text,
  p_document_hash text,
  p_rows jsonb,
  p_template_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_request_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_session_id uuid;
  v_existing_result jsonb;
  v_row record;
  v_operation_id uuid;
  v_existing_operation_id uuid;
  v_selected boolean;
  v_type text;
  v_amount numeric(15,2);
  v_date date;
  v_currency text;
  v_rate numeric(20,10);
  v_base_amount numeric(15,2);
  v_account_id uuid;
  v_category_id uuid;
  v_counterparty_id uuid;
  v_description text;
  v_fingerprint text;
  v_confidence numeric(4,3);
  v_receipt_comment text;
  v_rule_pattern text;
  v_tag record;
  v_tag_id uuid;
  v_confirmed integer := 0;
  v_duplicates integer := 0;
  v_skipped integer := 0;
  v_detected integer;
  v_results jsonb := '[]'::jsonb;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация';
  END IF;
  IF NOT public.user_has_role(
    v_actor, p_workspace_id, ARRAY['Owner', 'Admin', 'Member']
  ) THEN
    RAISE EXCEPTION 'Нет права импортировать операции';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Идентификатор запроса обязателен';
  END IF;
  IF p_source_kind NOT IN ('pdf', 'image', 'csv') THEN
    RAISE EXCEPTION 'Некорректный источник импорта';
  END IF;
  IF p_document_hash IS NULL OR p_document_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Некорректный хеш документа';
  END IF;
  IF char_length(btrim(COALESCE(p_bank, ''))) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'Некорректный идентификатор банка';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Строки импорта должны быть JSON-массивом';
  END IF;
  v_detected := jsonb_array_length(p_rows);
  IF v_detected < 1 OR v_detected > 500 THEN
    RAISE EXCEPTION 'Импорт должен содержать от 1 до 500 строк';
  END IF;
  IF jsonb_typeof(COALESCE(p_metadata, '{}'::jsonb)) <> 'object'
     OR octet_length(COALESCE(p_metadata, '{}'::jsonb)::text) > 4096 THEN
    RAISE EXCEPTION 'Некорректные метаданные импорта';
  END IF;

  -- Serialize retries of one logical client request. A completed retry returns
  -- byte-for-byte the stored result instead of creating another audit session.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_workspace_id::text || ':' || v_actor::text || ':' || p_request_id::text, 0)
  );
  SELECT result INTO v_existing_result
  FROM public.import_sessions
  WHERE workspace_id = p_workspace_id
    AND created_by = v_actor
    AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing_result IS NULL THEN
      RAISE EXCEPTION 'Запрос импорта уже зарегистрирован без итогового результата';
    END IF;
    RETURN v_existing_result;
  END IF;

  IF p_template_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.import_templates template
    WHERE template.id = p_template_id
      AND template.workspace_id = p_workspace_id
      AND NOT template.is_archived
  ) THEN
    RAISE EXCEPTION 'Шаблон импорта не найден или находится в архиве';
  END IF;

  INSERT INTO public.import_sessions (
    workspace_id, created_by, source_kind, bank, document_hash,
    detected_count, confirmed_count, duplicate_count, privacy_mode, status,
    request_id, template_id, metadata
  ) VALUES (
    p_workspace_id, v_actor, p_source_kind, btrim(p_bank), p_document_hash,
    v_detected, 0, 0, 'local-redacted', 'confirmed',
    p_request_id, p_template_id, COALESCE(p_metadata, '{}'::jsonb)
  ) RETURNING id INTO v_session_id;

  FOR v_row IN
    SELECT value, ordinality::integer AS row_number
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY
  LOOP
    IF jsonb_typeof(v_row.value) <> 'object' THEN
      RAISE EXCEPTION 'Строка % должна быть JSON-объектом', v_row.row_number;
    END IF;
    v_selected := COALESCE((v_row.value ->> 'selected')::boolean, true);
    IF NOT v_selected THEN
      v_skipped := v_skipped + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'row', v_row.row_number, 'status', 'skipped'
      ));
      CONTINUE;
    END IF;

    BEGIN
      v_type := v_row.value ->> 'type';
      v_amount := (v_row.value ->> 'amount')::numeric;
      v_date := (v_row.value ->> 'operation_date')::date;
      v_currency := upper(COALESCE(NULLIF(btrim(v_row.value ->> 'currency'), ''), 'KZT'));
      v_rate := COALESCE((v_row.value ->> 'exchange_rate')::numeric, 1);
      v_base_amount := COALESCE(
        (v_row.value ->> 'base_amount')::numeric,
        round(v_amount * v_rate, 2)
      );
      v_account_id := (v_row.value ->> 'account_id')::uuid;
      v_category_id := NULLIF(v_row.value ->> 'category_id', '')::uuid;
      v_counterparty_id := NULLIF(v_row.value ->> 'counterparty_id', '')::uuid;
      v_description := COALESCE(NULLIF(btrim(v_row.value ->> 'description'), ''), 'Импортированная операция');
      v_fingerprint := lower(v_row.value ->> 'import_fingerprint');
      v_confidence := NULLIF(v_row.value ->> 'import_confidence', '')::numeric;
      v_receipt_comment := NULLIF(btrim(v_row.value ->> 'receipt_items_comment'), '');
      v_rule_pattern := NULLIF(lower(btrim(v_row.value ->> 'rule_pattern')), '');
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range
      OR invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'Некорректные данные в строке %', v_row.row_number;
    END;

    IF v_type NOT IN ('income', 'expense', 'personal_salary', 'employee_salary') THEN
      RAISE EXCEPTION 'Некорректный тип операции в строке %', v_row.row_number;
    END IF;
    IF v_amount IS NULL OR v_amount <= 0 OR v_rate <= 0 OR v_base_amount <= 0 THEN
      RAISE EXCEPTION 'Сумма и курс должны быть больше нуля в строке %', v_row.row_number;
    END IF;
    IF char_length(v_description) > 5000 THEN
      RAISE EXCEPTION 'Описание слишком длинное в строке %', v_row.row_number;
    END IF;
    IF v_fingerprint IS NULL OR v_fingerprint !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'Некорректный отпечаток в строке %', v_row.row_number;
    END IF;
    IF v_confidence IS NOT NULL AND (v_confidence < 0 OR v_confidence > 1) THEN
      RAISE EXCEPTION 'Некорректная уверенность в строке %', v_row.row_number;
    END IF;
    IF v_receipt_comment IS NOT NULL AND char_length(v_receipt_comment) > 5000 THEN
      RAISE EXCEPTION 'Комментарий чека слишком длинный в строке %', v_row.row_number;
    END IF;
    IF v_row.value ? 'tagNames' AND jsonb_typeof(v_row.value -> 'tagNames') <> 'array' THEN
      RAISE EXCEPTION 'Теги строки % должны быть массивом', v_row.row_number;
    END IF;
    IF jsonb_array_length(COALESCE(v_row.value -> 'tagNames', '[]'::jsonb)) > 20 THEN
      RAISE EXCEPTION 'В строке % указано слишком много тегов', v_row.row_number;
    END IF;

    PERFORM 1 FROM public.accounts account
    WHERE account.id = v_account_id
      AND account.workspace_id = p_workspace_id
      AND NOT account.is_archived
      AND account.currency = v_currency;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Счёт не найден, архивирован или имеет другую валюту в строке %', v_row.row_number;
    END IF;

    IF v_category_id IS NOT NULL THEN
      PERFORM 1 FROM public.categories category
      WHERE category.id = v_category_id
        AND category.workspace_id = p_workspace_id
        AND NOT category.is_archived
        AND category.type = CASE
          WHEN v_type IN ('income', 'personal_salary') THEN 'income' ELSE 'expense'
        END;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Категория не найдена или не соответствует операции в строке %', v_row.row_number;
      END IF;
    END IF;

    IF v_counterparty_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.counterparties counterparty
      WHERE counterparty.id = v_counterparty_id
        AND counterparty.workspace_id = p_workspace_id
        AND NOT counterparty.is_archived
    ) THEN
      RAISE EXCEPTION 'Контрагент не найден или находится в архиве в строке %', v_row.row_number;
    END IF;

    v_operation_id := NULL;
    INSERT INTO public.operations (
      workspace_id, user_id, amount, type, description, operation_date,
      category_id, counterparty_id, account_id, currency, exchange_rate,
      base_amount, import_session_id, import_fingerprint, import_confidence, status
    ) VALUES (
      p_workspace_id, v_actor, v_amount, v_type, v_description, v_date,
      v_category_id, v_counterparty_id, v_account_id, v_currency, v_rate,
      v_base_amount, v_session_id, v_fingerprint, v_confidence, 'new'
    )
    ON CONFLICT (workspace_id, import_fingerprint)
      WHERE import_fingerprint IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_operation_id;

    IF v_operation_id IS NULL THEN
      SELECT id INTO v_existing_operation_id
      FROM public.operations
      WHERE workspace_id = p_workspace_id AND import_fingerprint = v_fingerprint;
      v_duplicates := v_duplicates + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'row', v_row.row_number, 'status', 'duplicate',
        'operation_id', v_existing_operation_id
      ));
      CONTINUE;
    END IF;

    INSERT INTO public.operation_status_events (
      workspace_id, operation_id, from_status, to_status, actor_id, reason
    ) VALUES (
      p_workspace_id, v_operation_id, NULL, 'new', v_actor, 'Создано атомарным импортом'
    );

    IF v_receipt_comment IS NOT NULL THEN
      INSERT INTO public.operation_comments (
        workspace_id, operation_id, author_id, body, kind
      ) VALUES (
        p_workspace_id, v_operation_id, v_actor, v_receipt_comment, 'receipt_items'
      );
    END IF;

    FOR v_tag IN
      SELECT value #>> '{}' AS name
      FROM jsonb_array_elements(COALESCE(v_row.value -> 'tagNames', '[]'::jsonb))
    LOOP
      v_tag.name := btrim(v_tag.name);
      IF char_length(v_tag.name) NOT BETWEEN 1 AND 50 THEN
        RAISE EXCEPTION 'Некорректный тег в строке %', v_row.row_number;
      END IF;
      INSERT INTO public.tags (workspace_id, name, color, is_archived)
      VALUES (p_workspace_id, v_tag.name, '#6B7280', false)
      ON CONFLICT (workspace_id, name) DO UPDATE SET is_archived = false
      RETURNING id INTO v_tag_id;
      INSERT INTO public.operation_tags (operation_id, tag_id)
      VALUES (v_operation_id, v_tag_id)
      ON CONFLICT DO NOTHING;
    END LOOP;

    IF COALESCE((v_row.value ->> 'remember_rule')::boolean, false) THEN
      IF v_category_id IS NULL OR v_rule_pattern IS NULL
         OR char_length(v_rule_pattern) NOT BETWEEN 3 AND 120 THEN
        RAISE EXCEPTION 'Некорректное правило категоризации в строке %', v_row.row_number;
      END IF;
      INSERT INTO public.category_rules (
        workspace_id, operation_type, pattern, category_id, created_by, updated_by
      ) VALUES (
        p_workspace_id, v_type, v_rule_pattern, v_category_id, v_actor, v_actor
      )
      ON CONFLICT (workspace_id, operation_type, pattern) DO UPDATE SET
        category_id = EXCLUDED.category_id,
        is_active = true,
        updated_by = v_actor,
        updated_at = now();
    END IF;

    v_confirmed := v_confirmed + 1;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'row', v_row.row_number, 'status', 'created', 'operation_id', v_operation_id
    ));
  END LOOP;

  v_result := jsonb_build_object(
    'session_id', v_session_id,
    'request_id', p_request_id,
    'detected_count', v_detected,
    'selected_count', v_detected - v_skipped,
    'confirmed_count', v_confirmed,
    'duplicate_count', v_duplicates,
    'skipped_count', v_skipped,
    'rows', v_results
  );

  UPDATE public.import_sessions
  SET confirmed_count = v_confirmed,
      duplicate_count = v_duplicates,
      result = v_result
  WHERE id = v_session_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.is_valid_import_mapping(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_valid_import_mapping(jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.protect_import_template_identity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.block_direct_import_session_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_import(uuid, text, text, text, jsonb, uuid, jsonb, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_import(uuid, text, text, text, jsonb, uuid, jsonb, uuid)
  TO authenticated;

COMMENT ON TABLE public.import_templates IS
  'Workspace-scoped, archivable CSV mappings. Raw CSV content is never stored.';
COMMENT ON FUNCTION public.confirm_import(uuid, text, text, text, jsonb, uuid, jsonb, uuid) IS
  'Atomically creates an immutable import session, new operations, receipt comments and opted-in category rules.';

COMMIT;
