-- Race-safe financial write receipts and conservative free-beta workspace quotas.

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE private.financial_write_requests (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  request_kind text NOT NULL CHECK (request_kind IN (
    'operation', 'transfer', 'transfer_v2', 'import'
  )),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  result jsonb NOT NULL CHECK (
    jsonb_typeof(result) = 'object' AND octet_length(result::text) <= 262144
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  PRIMARY KEY (user_id, request_id),
  CHECK (expires_at > created_at)
);

CREATE INDEX financial_write_requests_expiry_idx
  ON private.financial_write_requests(expires_at);
ALTER TABLE private.financial_write_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.financial_write_requests FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE private.workspace_resource_limits (
  resource text PRIMARY KEY,
  display_name text NOT NULL,
  max_items bigint NOT NULL CHECK (max_items > 0)
);

INSERT INTO private.workspace_resource_limits(resource, display_name, max_items) VALUES
  ('operations', 'операции', 50000),
  ('accounts', 'счета', 100),
  ('categories', 'категории', 500),
  ('tags', 'теги', 1000),
  ('counterparties', 'контрагенты', 5000),
  ('debts', 'долги', 5000),
  ('scheduled_operations', 'регулярные операции', 1000),
  ('import_templates', 'шаблоны импорта', 100),
  ('import_sessions', 'сессии импорта', 5000),
  ('operation_comments', 'комментарии операций', 100000),
  ('category_rules', 'правила категоризации', 2000),
  ('workspace_members', 'участники пространства', 25),
  ('workspace_invitations', 'приглашения', 1000),
  ('budgets', 'бюджеты', 10000),
  ('cashflow_plans', 'планы денежных потоков', 10000),
  ('savings_goals', 'накопительные цели', 1000),
  ('savings_goal_contributions', 'взносы в накопительные цели', 50000);

CREATE TABLE private.workspace_resource_usage (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  resource text NOT NULL REFERENCES private.workspace_resource_limits(resource) ON DELETE RESTRICT,
  item_count bigint NOT NULL CHECK (item_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, resource)
);

ALTER TABLE private.workspace_resource_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.workspace_resource_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.workspace_resource_limits, private.workspace_resource_usage
  FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO private.workspace_resource_usage(workspace_id, resource, item_count)
SELECT workspace_id, resource, count(*)::bigint
FROM (
  SELECT workspace_id, 'operations'::text AS resource FROM public.operations
  UNION ALL SELECT workspace_id, 'accounts' FROM public.accounts
  UNION ALL SELECT workspace_id, 'categories' FROM public.categories
  UNION ALL SELECT workspace_id, 'tags' FROM public.tags
  UNION ALL SELECT workspace_id, 'counterparties' FROM public.counterparties
  UNION ALL SELECT workspace_id, 'debts' FROM public.debts
  UNION ALL SELECT workspace_id, 'scheduled_operations' FROM public.scheduled_operations
  UNION ALL SELECT workspace_id, 'import_templates' FROM public.import_templates
  UNION ALL SELECT workspace_id, 'import_sessions' FROM public.import_sessions
  UNION ALL SELECT workspace_id, 'operation_comments' FROM public.operation_comments
  UNION ALL SELECT workspace_id, 'category_rules' FROM public.category_rules
  UNION ALL SELECT workspace_id, 'workspace_members' FROM public.workspace_members
  UNION ALL SELECT workspace_id, 'workspace_invitations' FROM public.workspace_invitations
  UNION ALL SELECT workspace_id, 'budgets' FROM public.budgets
  UNION ALL SELECT workspace_id, 'cashflow_plans' FROM public.cashflow_plans
  UNION ALL SELECT workspace_id, 'savings_goals' FROM public.savings_goals
  UNION ALL SELECT workspace_id, 'savings_goal_contributions' FROM public.savings_goal_contributions
) rows_to_count
GROUP BY workspace_id, resource;

CREATE OR REPLACE FUNCTION private.request_payload_hash(p_payload jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog, extensions
AS $$
  SELECT encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION private.begin_financial_write_request(
  p_workspace_id uuid,
  p_user_id uuid,
  p_request_id uuid,
  p_request_kind text,
  p_payload_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $$
DECLARE
  v_existing private.financial_write_requests;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Идентификатор запроса обязателен';
  END IF;
  IF p_payload_hash IS NULL OR p_payload_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Некорректный отпечаток запроса';
  END IF;

  DELETE FROM private.financial_write_requests request
  WHERE request.ctid IN (
    SELECT expired.ctid
    FROM private.financial_write_requests expired
    WHERE expired.expires_at <= now()
    ORDER BY expired.expires_at
    LIMIT 100
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended('financial:' || p_user_id::text || ':' || p_request_id::text, 0)
  );
  DELETE FROM private.financial_write_requests request
  WHERE request.user_id = p_user_id
    AND request.request_id = p_request_id
    AND request.expires_at <= now();

  SELECT * INTO v_existing
  FROM private.financial_write_requests request
  WHERE request.user_id = p_user_id AND request.request_id = p_request_id;

  IF FOUND THEN
    IF v_existing.workspace_id IS DISTINCT FROM p_workspace_id
       OR v_existing.request_kind IS DISTINCT FROM p_request_kind
       OR v_existing.payload_hash IS DISTINCT FROM p_payload_hash THEN
      RAISE EXCEPTION 'Идентификатор запроса уже использован с другими данными';
    END IF;
    RETURN v_existing.result;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.finish_financial_write_request(
  p_workspace_id uuid,
  p_user_id uuid,
  p_request_id uuid,
  p_request_kind text,
  p_payload_hash text,
  p_result jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $$
  INSERT INTO private.financial_write_requests(
    workspace_id, user_id, request_id, request_kind, payload_hash, result
  ) VALUES (
    p_workspace_id, p_user_id, p_request_id, p_request_kind, p_payload_hash, p_result
  );
$$;

CREATE OR REPLACE FUNCTION private.apply_operation_tags(
  p_workspace_id uuid,
  p_operation_ids uuid[],
  p_tag_names text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF cardinality(COALESCE(p_tag_names, '{}'::text[])) > 20 OR EXISTS (
    SELECT 1 FROM unnest(COALESCE(p_tag_names, '{}'::text[])) name
    WHERE name IS NULL OR char_length(btrim(name)) NOT BETWEEN 1 AND 50
  ) THEN
    RAISE EXCEPTION 'Один или несколько тегов некорректны';
  END IF;

  INSERT INTO public.tags(workspace_id, name, color, is_archived)
  SELECT DISTINCT p_workspace_id, btrim(name), '#6B7280', false
  FROM unnest(COALESCE(p_tag_names, '{}'::text[])) name
  ON CONFLICT (workspace_id, name) DO UPDATE SET is_archived = false;

  INSERT INTO public.operation_tags(operation_id, tag_id)
  SELECT requested.operation_id, tag.id
  FROM unnest(COALESCE(p_operation_ids, '{}'::uuid[])) AS requested(operation_id)
  JOIN public.operations operation
    ON operation.id = requested.operation_id AND operation.workspace_id = p_workspace_id
  JOIN public.tags tag
    ON tag.workspace_id = p_workspace_id
   AND tag.name IN (
     SELECT btrim(name) FROM unnest(COALESCE(p_tag_names, '{}'::text[])) name
   )
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION private.enforce_workspace_resource_quota()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $$
DECLARE
  v_resource text := TG_ARGV[0];
  v_workspace_id uuid;
  v_old_workspace_id uuid;
  v_limit bigint;
  v_label text;
  v_count bigint;
BEGIN
  SELECT limits.max_items, limits.display_name INTO v_limit, v_label
  FROM private.workspace_resource_limits limits
  WHERE limits.resource = v_resource;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Не настроена квота ресурса %', v_resource;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_old_workspace_id := OLD.workspace_id;
    UPDATE private.workspace_resource_usage usage
    SET item_count = greatest(usage.item_count - 1, 0), updated_at = now()
    WHERE usage.workspace_id = v_old_workspace_id AND usage.resource = v_resource;
    RETURN OLD;
  END IF;

  v_workspace_id := NEW.workspace_id;
  IF TG_OP = 'UPDATE' THEN
    v_old_workspace_id := OLD.workspace_id;
    IF v_old_workspace_id IS NOT DISTINCT FROM v_workspace_id THEN RETURN NEW; END IF;
    UPDATE private.workspace_resource_usage usage
    SET item_count = greatest(usage.item_count - 1, 0), updated_at = now()
    WHERE usage.workspace_id = v_old_workspace_id AND usage.resource = v_resource;
  END IF;

  INSERT INTO private.workspace_resource_usage(workspace_id, resource, item_count)
  VALUES (v_workspace_id, v_resource, 1)
  ON CONFLICT (workspace_id, resource) DO UPDATE
    SET item_count = private.workspace_resource_usage.item_count + 1,
        updated_at = now()
    WHERE private.workspace_resource_usage.item_count < v_limit
  RETURNING item_count INTO v_count;

  IF v_count IS NULL THEN
    RAISE EXCEPTION 'Достигнут лимит beta: % (%)', v_label, v_limit;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER quota_operations AFTER INSERT OR DELETE OR UPDATE OF workspace_id ON public.operations
  FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_resource_quota('operations');
CREATE TRIGGER quota_accounts AFTER INSERT OR DELETE OR UPDATE OF workspace_id ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_resource_quota('accounts');
CREATE TRIGGER quota_categories AFTER INSERT OR DELETE OR UPDATE OF workspace_id ON public.categories
  FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_resource_quota('categories');
CREATE TRIGGER quota_tags AFTER INSERT OR DELETE OR UPDATE OF workspace_id ON public.tags
  FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_resource_quota('tags');
CREATE TRIGGER quota_counterparties AFTER INSERT OR DELETE OR UPDATE OF workspace_id ON public.counterparties
  FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_resource_quota('counterparties');
CREATE TRIGGER quota_debts AFTER INSERT OR DELETE OR UPDATE OF workspace_id ON public.debts
  FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_resource_quota('debts');
CREATE TRIGGER quota_scheduled_operations AFTER INSERT OR DELETE OR UPDATE OF workspace_id ON public.scheduled_operations
  FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_resource_quota('scheduled_operations');
CREATE TRIGGER quota_import_templates AFTER INSERT OR DELETE OR UPDATE OF workspace_id ON public.import_templates
  FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_resource_quota('import_templates');
CREATE TRIGGER quota_import_sessions AFTER INSERT OR DELETE OR UPDATE OF workspace_id ON public.import_sessions
  FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_resource_quota('import_sessions');
CREATE TRIGGER quota_operation_comments AFTER INSERT OR DELETE OR UPDATE OF workspace_id ON public.operation_comments
  FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_resource_quota('operation_comments');
CREATE TRIGGER quota_category_rules AFTER INSERT OR DELETE OR UPDATE OF workspace_id ON public.category_rules
  FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_resource_quota('category_rules');
CREATE TRIGGER quota_workspace_members AFTER INSERT OR DELETE OR UPDATE OF workspace_id ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_resource_quota('workspace_members');
CREATE TRIGGER quota_workspace_invitations AFTER INSERT OR DELETE OR UPDATE OF workspace_id ON public.workspace_invitations
  FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_resource_quota('workspace_invitations');
CREATE TRIGGER quota_budgets AFTER INSERT OR DELETE OR UPDATE OF workspace_id ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_resource_quota('budgets');
CREATE TRIGGER quota_cashflow_plans AFTER INSERT OR DELETE OR UPDATE OF workspace_id ON public.cashflow_plans
  FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_resource_quota('cashflow_plans');
CREATE TRIGGER quota_savings_goals AFTER INSERT OR DELETE OR UPDATE OF workspace_id ON public.savings_goals
  FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_resource_quota('savings_goals');
CREATE TRIGGER quota_savings_goal_contributions AFTER INSERT OR DELETE OR UPDATE OF workspace_id ON public.savings_goal_contributions
  FOR EACH ROW EXECUTE FUNCTION private.enforce_workspace_resource_quota('savings_goal_contributions');

CREATE OR REPLACE FUNCTION public.create_operation_idempotent(
  p_client_request_id uuid,
  p_workspace_id uuid,
  p_amount numeric,
  p_type text,
  p_description text,
  p_operation_date date,
  p_category_id uuid,
  p_counterparty_id uuid,
  p_account_id uuid,
  p_currency text,
  p_exchange_rate numeric,
  p_base_amount numeric,
  p_debt_id uuid,
  p_debt_applied_amount numeric,
  p_allocations jsonb DEFAULT '[]'::jsonb,
  p_tag_names text[] DEFAULT '{}'::text[]
)
RETURNS public.operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_hash text;
  v_existing jsonb;
  v_operation public.operations;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Требуется авторизация'; END IF;
  v_hash := private.request_payload_hash(jsonb_build_object(
    'workspace_id', p_workspace_id, 'amount', p_amount, 'type', p_type,
    'description', COALESCE(p_description, ''), 'operation_date', p_operation_date,
    'category_id', p_category_id, 'counterparty_id', p_counterparty_id,
    'account_id', p_account_id, 'currency', upper(p_currency),
    'exchange_rate', p_exchange_rate, 'base_amount', p_base_amount,
    'debt_id', p_debt_id, 'debt_applied_amount', p_debt_applied_amount,
    'allocations', COALESCE(p_allocations, '[]'::jsonb),
    'tag_names', COALESCE(to_jsonb(p_tag_names), '[]'::jsonb)
  ));
  v_existing := private.begin_financial_write_request(
    p_workspace_id, v_actor, p_client_request_id, 'operation', v_hash
  );
  IF v_existing IS NOT NULL THEN
    SELECT * INTO v_operation FROM public.operations
    WHERE id = (v_existing ->> 'operation_id')::uuid AND workspace_id = p_workspace_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Результат повторного запроса больше недоступен'; END IF;
    RETURN v_operation;
  END IF;

  v_operation := public.create_operation_with_allocations(
    p_workspace_id, p_amount, p_type, p_description, p_operation_date,
    p_category_id, p_counterparty_id, p_account_id, p_currency,
    p_exchange_rate, p_base_amount, p_debt_id, p_debt_applied_amount,
    COALESCE(p_allocations, '[]'::jsonb), COALESCE(p_tag_names, '{}'::text[])
  );
  PERFORM private.finish_financial_write_request(
    p_workspace_id, v_actor, p_client_request_id, 'operation', v_hash,
    jsonb_build_object('operation_id', v_operation.id)
  );
  RETURN v_operation;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_transfer_idempotent(
  p_client_request_id uuid,
  p_workspace_id uuid,
  p_user_id uuid,
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount numeric,
  p_description text DEFAULT NULL,
  p_operation_date date DEFAULT CURRENT_DATE,
  p_tag_names text[] DEFAULT '{}'::text[]
)
RETURNS TABLE (transfer_group_id uuid, out_operation_id uuid, in_operation_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
#variable_conflict use_column
DECLARE
  v_actor uuid := CASE WHEN auth.role() = 'service_role' THEN p_user_id ELSE auth.uid() END;
  v_hash text;
  v_existing jsonb;
  v_transfer record;
BEGIN
  IF v_actor IS NULL OR p_user_id IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Недопустимый пользователь'; END IF;
  v_hash := private.request_payload_hash(jsonb_build_object(
    'workspace_id', p_workspace_id, 'user_id', p_user_id,
    'from_account_id', p_from_account_id, 'to_account_id', p_to_account_id,
    'amount', p_amount, 'description', COALESCE(p_description, ''),
    'operation_date', p_operation_date,
    'tag_names', COALESCE(to_jsonb(p_tag_names), '[]'::jsonb)
  ));
  v_existing := private.begin_financial_write_request(
    p_workspace_id, v_actor, p_client_request_id, 'transfer', v_hash
  );
  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_existing ->> 'transfer_group_id')::uuid,
      (v_existing ->> 'out_operation_id')::uuid,
      (v_existing ->> 'in_operation_id')::uuid;
    RETURN;
  END IF;

  SELECT * INTO v_transfer FROM public.create_transfer(
    p_workspace_id, p_user_id, p_from_account_id, p_to_account_id,
    p_amount, p_description, p_operation_date
  );
  PERFORM private.apply_operation_tags(
    p_workspace_id, ARRAY[v_transfer.out_operation_id, v_transfer.in_operation_id], p_tag_names
  );
  PERFORM private.finish_financial_write_request(
    p_workspace_id, v_actor, p_client_request_id, 'transfer', v_hash,
    jsonb_build_object(
      'transfer_group_id', v_transfer.transfer_group_id,
      'out_operation_id', v_transfer.out_operation_id,
      'in_operation_id', v_transfer.in_operation_id
    )
  );
  RETURN QUERY SELECT v_transfer.transfer_group_id, v_transfer.out_operation_id, v_transfer.in_operation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_transfer_v2_idempotent(
  p_client_request_id uuid,
  p_workspace_id uuid,
  p_user_id uuid,
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_from_amount numeric,
  p_to_amount numeric,
  p_from_currency text,
  p_to_currency text,
  p_exchange_rate numeric,
  p_description text DEFAULT NULL,
  p_operation_date date DEFAULT CURRENT_DATE,
  p_tag_names text[] DEFAULT '{}'::text[]
)
RETURNS TABLE (transfer_group_id uuid, out_operation_id uuid, in_operation_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
#variable_conflict use_column
DECLARE
  v_actor uuid := CASE WHEN auth.role() = 'service_role' THEN p_user_id ELSE auth.uid() END;
  v_hash text;
  v_existing jsonb;
  v_transfer record;
BEGIN
  IF v_actor IS NULL OR p_user_id IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Недопустимый пользователь'; END IF;
  v_hash := private.request_payload_hash(jsonb_build_object(
    'workspace_id', p_workspace_id, 'user_id', p_user_id,
    'from_account_id', p_from_account_id, 'to_account_id', p_to_account_id,
    'from_amount', p_from_amount, 'to_amount', p_to_amount,
    'from_currency', upper(p_from_currency), 'to_currency', upper(p_to_currency),
    'exchange_rate', p_exchange_rate, 'description', COALESCE(p_description, ''),
    'operation_date', p_operation_date,
    'tag_names', COALESCE(to_jsonb(p_tag_names), '[]'::jsonb)
  ));
  v_existing := private.begin_financial_write_request(
    p_workspace_id, v_actor, p_client_request_id, 'transfer_v2', v_hash
  );
  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_existing ->> 'transfer_group_id')::uuid,
      (v_existing ->> 'out_operation_id')::uuid,
      (v_existing ->> 'in_operation_id')::uuid;
    RETURN;
  END IF;

  SELECT * INTO v_transfer FROM public.create_transfer_v2(
    p_workspace_id, p_user_id, p_from_account_id, p_to_account_id,
    p_from_amount, p_to_amount, p_from_currency, p_to_currency,
    p_exchange_rate, p_description, p_operation_date
  );
  PERFORM private.apply_operation_tags(
    p_workspace_id, ARRAY[v_transfer.out_operation_id, v_transfer.in_operation_id], p_tag_names
  );
  PERFORM private.finish_financial_write_request(
    p_workspace_id, v_actor, p_client_request_id, 'transfer_v2', v_hash,
    jsonb_build_object(
      'transfer_group_id', v_transfer.transfer_group_id,
      'out_operation_id', v_transfer.out_operation_id,
      'in_operation_id', v_transfer.in_operation_id
    )
  );
  RETURN QUERY SELECT v_transfer.transfer_group_id, v_transfer.out_operation_id, v_transfer.in_operation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_import_idempotent(
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
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_hash text;
  v_existing jsonb;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Требуется авторизация'; END IF;
  v_hash := private.request_payload_hash(jsonb_build_object(
    'workspace_id', p_workspace_id, 'source_kind', p_source_kind,
    'bank', p_bank, 'document_hash', p_document_hash,
    'rows', p_rows, 'template_id', p_template_id,
    'metadata', COALESCE(p_metadata, '{}'::jsonb)
  ));
  v_existing := private.begin_financial_write_request(
    p_workspace_id, v_actor, p_request_id, 'import', v_hash
  );
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  v_result := public.confirm_import(
    p_workspace_id, p_source_kind, p_bank, p_document_hash, p_rows,
    p_template_id, COALESCE(p_metadata, '{}'::jsonb), p_request_id
  );
  PERFORM private.finish_financial_write_request(
    p_workspace_id, v_actor, p_request_id, 'import', v_hash, v_result
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION private.request_payload_hash(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.begin_financial_write_request(uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.finish_financial_write_request(uuid, uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.apply_operation_tags(uuid, uuid[], text[]) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.enforce_workspace_resource_quota() FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_operation_idempotent(uuid, uuid, numeric, text, text, date, uuid, uuid, uuid, text, numeric, numeric, uuid, numeric, jsonb, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_transfer_idempotent(uuid, uuid, uuid, uuid, uuid, numeric, text, date, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_transfer_v2_idempotent(uuid, uuid, uuid, uuid, uuid, numeric, numeric, text, text, numeric, text, date, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_import_idempotent(uuid, text, text, text, jsonb, uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_operation_idempotent(uuid, uuid, numeric, text, text, date, uuid, uuid, uuid, text, numeric, numeric, uuid, numeric, jsonb, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_transfer_idempotent(uuid, uuid, uuid, uuid, uuid, numeric, text, date, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_transfer_v2_idempotent(uuid, uuid, uuid, uuid, uuid, numeric, numeric, text, text, numeric, text, date, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_import_idempotent(uuid, text, text, text, jsonb, uuid, jsonb, uuid) TO authenticated;

COMMENT ON TABLE private.financial_write_requests IS
  'Seven-day, payload-bound receipts for atomic replay of financial writes.';
COMMENT ON TABLE private.workspace_resource_usage IS
  'Transactionally maintained per-workspace counters for free-beta storage quotas.';

COMMIT;
