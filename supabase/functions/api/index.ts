import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const OPERATION_TYPES = new Set(['income', 'expense', 'personal_salary', 'employee_salary']);

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

function errorResponse(error: string, status: number) {
  return jsonResponse({ error }, status);
}

async function getAuthenticatedClient(req: Request) {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return null;

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  return { supabase, user };
}

function validDate(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

async function resolveOperationMoney(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  requestedAccountId: unknown,
  amount: number,
  operationDate: string,
) {
  let accountId = typeof requestedAccountId === 'string' ? requestedAccountId : '';
  if (!accountId) {
    const { data: defaultAccount, error: defaultError } = await supabase
      .from('accounts')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('is_default', true)
      .eq('is_archived', false)
      .maybeSingle();
    if (defaultError || !defaultAccount) return { error: 'Active account is required' };
    accountId = defaultAccount.id;
  }

  const [{ data: account, error: accountError }, { data: workspace, error: workspaceError }] = await Promise.all([
    supabase.from('accounts').select('id, currency').eq('id', accountId).eq('workspace_id', workspaceId).eq('is_archived', false).maybeSingle(),
    supabase.from('workspaces').select('base_currency').eq('id', workspaceId).maybeSingle(),
  ]);
  if (accountError || !account) return { error: 'Account is unavailable in this workspace' };
  if (workspaceError || !workspace) return { error: 'Workspace is unavailable' };

  const currency = account.currency;
  const baseCurrency = workspace.base_currency || 'KZT';
  let exchangeRate = 1;
  if (currency !== baseCurrency) {
    const { data: rate, error: rateError } = await supabase.rpc('get_exchange_rate', {
      p_workspace_id: workspaceId,
      p_from_currency: currency,
      p_to_currency: baseCurrency,
      p_rate_date: operationDate,
    });
    exchangeRate = Number(rate);
    if (rateError || !Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      return { error: `Exchange rate ${currency} → ${baseCurrency} is missing for ${operationDate}` };
    }
  }

  return {
    accountId,
    currency,
    exchangeRate,
    baseAmount: Math.round(amount * exchangeRate * 100) / 100,
  };
}

async function validateCategory(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  categoryId: unknown,
) {
  if (!categoryId) return true;
  if (typeof categoryId !== 'string') return false;
  const { data } = await supabase
    .from('categories')
    .select('id')
    .eq('id', categoryId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  return Boolean(data);
}

async function validateTags(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  tagIds: unknown,
) {
  if (!Array.isArray(tagIds)) return tagIds === undefined;
  if (tagIds.length === 0) return true;
  if (tagIds.some((id) => typeof id !== 'string')) return false;
  const uniqueIds = [...new Set(tagIds as string[])];
  const { data } = await supabase
    .from('tags')
    .select('id')
    .eq('workspace_id', workspaceId)
    .in('id', uniqueIds);
  return (data || []).length === uniqueIds.length;
}

// --- Route Handlers ---

async function getWorkspaces(supabase: ReturnType<typeof createClient>) {
  const { data, error } = await supabase
    .from('workspace_members')
    .select('workspace_id, role, workspaces(id, name, is_personal, workspace_type, created_at)')
    .eq('is_active', true);

  if (error) return errorResponse(error.message, 500);
  return jsonResponse(data);
}

async function getWorkspaceSummary(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  url: URL,
) {
  const dateFrom = url.searchParams.get('dateFrom');
  const dateTo = url.searchParams.get('dateTo');

  if ((dateFrom && !validDate(dateFrom)) || (dateTo && !validDate(dateTo))) {
    return errorResponse('Dates must use YYYY-MM-DD', 400);
  }
  const { data, error } = await supabase
    .rpc('get_workspace_operation_totals', {
      p_workspace_id: workspaceId,
      p_date_from: dateFrom || null,
      p_date_to: dateTo || null,
    })
    .single();
  if (error) return errorResponse(error.message, 500);
  return jsonResponse(data);
}

async function getOperations(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  url: URL,
) {
  const dateFrom = url.searchParams.get('dateFrom');
  const dateTo = url.searchParams.get('dateTo');
  const requestedLimit = Number.parseInt(url.searchParams.get('limit') || '50', 10);
  const requestedOffset = Number.parseInt(url.searchParams.get('offset') || '0', 10);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 200) : 50;
  const offset = Number.isFinite(requestedOffset) ? Math.max(requestedOffset, 0) : 0;

  let query = supabase
    .from('operations')
    .select(
      'id, workspace_id, user_id, amount, type, description, operation_date, created_at, category_id, tags:operation_tags(tag_id, tags(id, name, color))',
    )
    .eq('workspace_id', workspaceId)
    .order('operation_date', { ascending: false })
    .range(offset, offset + limit - 1);

  if (dateFrom) query = query.gte('operation_date', dateFrom);
  if (dateTo) query = query.lte('operation_date', dateTo);

  const { data, error } = await query;
  if (error) return errorResponse(error.message, 500);
  return jsonResponse(data);
}

async function exportOperations(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  url: URL,
) {
  const dateFrom = url.searchParams.get('dateFrom');
  const dateTo = url.searchParams.get('dateTo');
  const type = url.searchParams.get('type');
  const categoryId = url.searchParams.get('category_id');
  const sortBy = url.searchParams.get('sortBy') || 'operation_date'; // operation_date, amount, created_at
  const sortOrder = url.searchParams.get('sortOrder') || 'desc'; // asc, desc
  const limit = parseInt(url.searchParams.get('limit') || '0', 10); // 0 = no limit
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  const allowedSort = ['operation_date', 'amount', 'created_at', 'description'];
  const sortField = allowedSort.includes(sortBy) ? sortBy : 'operation_date';
  const ascending = sortOrder === 'asc';

  let query = supabase
    .from('operations')
    .select(
      'id, workspace_id, user_id, amount, type, description, operation_date, created_at, updated_at, category_id, categories(id, name, type, color), tags:operation_tags(tag_id, tags(id, name, color))',
    )
    .eq('workspace_id', workspaceId)
    .order(sortField, { ascending });

  if (dateFrom) query = query.gte('operation_date', dateFrom);
  if (dateTo) query = query.lte('operation_date', dateTo);
  if (type) query = query.eq('type', type);
  if (categoryId) query = query.eq('category_id', categoryId);
  if (limit > 0) query = query.range(offset, offset + limit - 1);

  const { data, error } = await query;
  if (error) return errorResponse(error.message, 500);

  return jsonResponse({
    count: data?.length || 0,
    filters: { dateFrom, dateTo, type, categoryId, sortBy: sortField, sortOrder: ascending ? 'asc' : 'desc' },
    operations: data,
  });
}

async function createOperation(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  userId: string,
  body: Record<string, unknown>,
) {
  const { amount, type, description, category_id, operation_date, tag_ids, account_id } = body;
  const numericAmount = Number(amount);
  const operationType = typeof type === 'string' ? type.toLowerCase() : '';
  const operationDate = operation_date === undefined
    ? new Date().toISOString().split('T')[0]
    : operation_date;

  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !operationType) {
    return errorResponse('amount and type are required', 400);
  }
  if (!OPERATION_TYPES.has(operationType)) {
    return errorResponse('type must be income, expense, personal_salary or employee_salary; use /transfers for transfers', 400);
  }
  if (!validDate(operationDate)) return errorResponse('operation_date must use YYYY-MM-DD', 400);
  if (!await validateCategory(supabase, workspaceId, category_id)) {
    return errorResponse('Category is unavailable in this workspace', 400);
  }
  if (!await validateTags(supabase, workspaceId, tag_ids)) {
    return errorResponse('One or more tags are unavailable in this workspace', 400);
  }

  const money = await resolveOperationMoney(
    supabase, workspaceId, account_id, numericAmount, operationDate,
  );
  if ('error' in money) return errorResponse(money.error, 422);

  const { data, error } = await supabase
    .from('operations')
    .insert({
      workspace_id: workspaceId,
      user_id: userId,
      amount: numericAmount,
      type: operationType,
      description: description || null,
      category_id: category_id || null,
      account_id: money.accountId,
      operation_date: operationDate,
      currency: money.currency,
      exchange_rate: money.exchangeRate,
      base_amount: money.baseAmount,
    })
    .select()
    .single();

  if (error) return errorResponse(error.message, 500);

  if (Array.isArray(tag_ids) && tag_ids.length > 0) {
    const tagRows = tag_ids.map((tag_id: string) => ({
      operation_id: data.id,
      tag_id,
    }));
    const { error: tagError } = await supabase
      .from('operation_tags')
      .insert(tagRows);
    if (tagError) return errorResponse(tagError.message, 500);
  }

  return jsonResponse(data, 201);
}

async function updateOperation(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  opId: string,
  body: Record<string, unknown>,
) {
  const { tag_ids } = body;
  const { data: current, error: currentError } = await supabase
    .from('operations')
    .select('amount, type, description, category_id, account_id, operation_date')
    .eq('id', opId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (currentError || !current) return errorResponse('Operation not found', 404);
  if (current.type === 'transfer') return errorResponse('Use /transfers to update transfers', 400);

  const numericAmount = body.amount === undefined ? Number(current.amount) : Number(body.amount);
  const operationType = body.type === undefined ? current.type : String(body.type).toLowerCase();
  const operationDate = body.operation_date === undefined ? current.operation_date : body.operation_date;
  const categoryId = body.category_id === undefined ? current.category_id : body.category_id;
  const accountId = body.account_id === undefined ? current.account_id : body.account_id;
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) return errorResponse('amount must be greater than zero', 400);
  if (!OPERATION_TYPES.has(operationType)) return errorResponse('Invalid operation type', 400);
  if (!validDate(operationDate)) return errorResponse('operation_date must use YYYY-MM-DD', 400);
  if (!await validateCategory(supabase, workspaceId, categoryId)) return errorResponse('Invalid category', 400);
  if (!await validateTags(supabase, workspaceId, tag_ids)) return errorResponse('Invalid tags', 400);

  const money = await resolveOperationMoney(supabase, workspaceId, accountId, numericAmount, operationDate);
  if ('error' in money) return errorResponse(money.error, 422);
  const fields = {
    amount: numericAmount,
    type: operationType,
    description: body.description === undefined ? current.description : body.description,
    category_id: categoryId || null,
    account_id: money.accountId,
    operation_date: operationDate,
    currency: money.currency,
    exchange_rate: money.exchangeRate,
    base_amount: money.baseAmount,
  };

  const { data, error } = await supabase
    .from('operations')
    .update(fields)
    .eq('id', opId)
    .eq('workspace_id', workspaceId)
    .select()
    .single();

  if (error) return errorResponse(error.message, error.code === 'PGRST116' ? 404 : 500);

  if (Array.isArray(tag_ids)) {
    await supabase.from('operation_tags').delete().eq('operation_id', opId);
    if (tag_ids.length > 0) {
      const tagRows = tag_ids.map((tag_id: string) => ({
        operation_id: opId,
        tag_id,
      }));
      await supabase.from('operation_tags').insert(tagRows);
    }
  }

  return jsonResponse(data);
}

async function deleteOperation(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  opId: string,
) {
  const { error } = await supabase
    .from('operations')
    .delete()
    .eq('id', opId)
    .eq('workspace_id', workspaceId);

  if (error) return errorResponse(error.message, 500);
  return jsonResponse({ success: true });
}

async function getCategories(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from('categories')
    .select('id, workspace_id, name, type, color, is_archived')
    .eq('workspace_id', workspaceId)
    .order('name');

  if (error) return errorResponse(error.message, 500);
  return jsonResponse(data);
}

async function createCategory(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  _userId: string,
  body: Record<string, unknown>,
) {
  const { name, type, color } = body;
  if (!name || !type) return errorResponse('name and type are required', 400);

  const { data, error } = await supabase
    .from('categories')
    .insert({
      workspace_id: workspaceId,
      name,
      type,
      color: color || '#6B7280',
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') return errorResponse('Category already exists', 409);
    return errorResponse(error.message, 500);
  }
  return jsonResponse(data, 201);
}

async function updateCategory(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  catId: string,
  body: Record<string, unknown>,
) {
  const { data, error } = await supabase
    .from('categories')
    .update(body)
    .eq('id', catId)
    .eq('workspace_id', workspaceId)
    .select()
    .single();

  if (error) return errorResponse(error.message, error.code === 'PGRST116' ? 404 : 500);
  return jsonResponse(data);
}

async function getTags(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from('tags')
    .select('id, workspace_id, name, color, is_archived')
    .eq('workspace_id', workspaceId)
    .order('name');

  if (error) return errorResponse(error.message, 500);
  return jsonResponse(data);
}

async function createTag(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  _userId: string,
  body: Record<string, unknown>,
) {
  const { name, color } = body;
  if (!name) return errorResponse('name is required', 400);

  const { data, error } = await supabase
    .from('tags')
    .insert({
      workspace_id: workspaceId,
      name,
      color: color || '#6B7280',
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') return errorResponse('Tag already exists', 409);
    return errorResponse(error.message, 500);
  }
  return jsonResponse(data, 201);
}

async function updateTag(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  tagId: string,
  body: Record<string, unknown>,
) {
  const { data, error } = await supabase
    .from('tags')
    .update(body)
    .eq('id', tagId)
    .eq('workspace_id', workspaceId)
    .select()
    .single();

  if (error) return errorResponse(error.message, error.code === 'PGRST116' ? 404 : 500);
  return jsonResponse(data);
}

// --- Accounts ---

async function getAccounts(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from('accounts')
    .select('id, workspace_id, name, color, is_default, is_archived, created_at, updated_at')
    .eq('workspace_id', workspaceId)
    .order('is_default', { ascending: false })
    .order('name');

  if (error) return errorResponse(error.message, 500);
  return jsonResponse(data);
}

async function createAccount(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  body: Record<string, unknown>,
) {
  const { name, color } = body;
  if (!name) return errorResponse('name is required', 400);

  const { data, error } = await supabase
    .from('accounts')
    .insert({ workspace_id: workspaceId, name, color: color || '#6B7280' })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') return errorResponse('Account name already exists', 409);
    return errorResponse(error.message, 500);
  }
  return jsonResponse(data, 201);
}

async function updateAccount(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  accountId: string,
  body: Record<string, unknown>,
) {
  const { data, error } = await supabase
    .from('accounts')
    .update(body)
    .eq('id', accountId)
    .eq('workspace_id', workspaceId)
    .select()
    .single();

  if (error) return errorResponse(error.message, error.code === 'PGRST116' ? 404 : 500);
  return jsonResponse(data);
}

async function deleteAccount(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  accountId: string,
) {
  const { error } = await supabase
    .from('accounts')
    .delete()
    .eq('id', accountId)
    .eq('workspace_id', workspaceId);

  if (error) return errorResponse(error.message, 500);
  return jsonResponse({ success: true });
}

async function getAccountBalances(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
) {
  const { data, error } = await supabase.rpc('get_account_balances', { p_workspace_id: workspaceId });
  if (error) return errorResponse(error.message, 500);
  return jsonResponse(data);
}

// --- Transfers ---

async function createTransfer(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  userId: string,
  body: Record<string, unknown>,
) {
  const { from_account_id, to_account_id, amount, description, operation_date } = body;
  if (!from_account_id || !to_account_id || !amount) {
    return errorResponse('from_account_id, to_account_id, and amount are required', 400);
  }

  const { data, error } = await supabase.rpc('create_transfer', {
    p_workspace_id: workspaceId,
    p_user_id: userId,
    p_from_account_id: from_account_id,
    p_to_account_id: to_account_id,
    p_amount: amount,
    p_description: description || null,
    p_operation_date: operation_date || new Date().toISOString().split('T')[0],
  });

  if (error) return errorResponse(error.message, 500);
  return jsonResponse(data?.[0] || data, 201);
}

async function updateTransfer(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  transferGroupId: string,
  body: Record<string, unknown>,
) {
  const { data, error } = await supabase.rpc('update_transfer', {
    p_workspace_id: workspaceId,
    p_transfer_group_id: transferGroupId,
    p_from_account_id: body.from_account_id || null,
    p_to_account_id: body.to_account_id || null,
    p_amount: body.amount || null,
    p_description: body.description !== undefined ? body.description : null,
    p_operation_date: body.operation_date || null,
  });

  if (error) return errorResponse(error.message, 500);
  return jsonResponse(data?.[0] || data);
}

async function deleteTransfer(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  transferGroupId: string,
) {
  const { error } = await supabase
    .from('operations')
    .delete()
    .eq('transfer_group_id', transferGroupId)
    .eq('workspace_id', workspaceId);

  if (error) return errorResponse(error.message, 500);
  return jsonResponse({ success: true });
}

// --- Main Router ---

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const auth = await getAuthenticatedClient(req);
    if (!auth) return errorResponse('Unauthorized', 401);

    const { supabase, user } = auth;
    const url = new URL(req.url);

    // Strip function prefix: /api/... → parse segments after /api
    const fullPath = url.pathname;
    const apiIndex = fullPath.indexOf('/api');
    const path = apiIndex !== -1 ? fullPath.slice(apiIndex + 4) : fullPath;
    const segments = path.split('/').filter(Boolean);
    const method = req.method;

    // Parse body for POST/PATCH
    let body: Record<string, unknown> = {};
    if (method === 'POST' || method === 'PATCH') {
      body = await req.json();
    }

    // GET /workspaces
    if (segments[0] === 'workspaces' && segments.length === 1 && method === 'GET') {
      return await getWorkspaces(supabase);
    }

    // /workspaces/:id/...
    if (segments[0] === 'workspaces' && segments.length >= 2) {
      const workspaceId = segments[1];

      // GET /workspaces/:id/summary
      if (segments[2] === 'summary' && method === 'GET') {
        return await getWorkspaceSummary(supabase, workspaceId, url);
      }

      // /workspaces/:id/operations
      if (segments[2] === 'operations') {
        if (segments.length === 3) {
          if (method === 'GET') return await getOperations(supabase, workspaceId, url);
          if (method === 'POST') return await createOperation(supabase, workspaceId, user.id, body);
        }
        // GET /workspaces/:id/operations/export
        if (segments.length === 4 && segments[3] === 'export' && method === 'GET') {
          return await exportOperations(supabase, workspaceId, url);
        }
        if (segments.length === 4) {
          const opId = segments[3];
          if (method === 'PATCH') return await updateOperation(supabase, workspaceId, opId, body);
          if (method === 'DELETE') return await deleteOperation(supabase, workspaceId, opId);
        }
      }

      // /workspaces/:id/accounts
      if (segments[2] === 'accounts') {
        if (segments.length === 3) {
          if (method === 'GET') return await getAccounts(supabase, workspaceId);
          if (method === 'POST') return await createAccount(supabase, workspaceId, body);
        }
        if (segments.length === 4 && segments[3] === 'balances' && method === 'GET') {
          return await getAccountBalances(supabase, workspaceId);
        }
        if (segments.length === 4) {
          if (method === 'PATCH') return await updateAccount(supabase, workspaceId, segments[3], body);
          if (method === 'DELETE') return await deleteAccount(supabase, workspaceId, segments[3]);
        }
      }

      // /workspaces/:id/transfers
      if (segments[2] === 'transfers') {
        if (segments.length === 3 && method === 'POST') {
          return await createTransfer(supabase, workspaceId, user.id, body);
        }
        if (segments.length === 4) {
          if (method === 'PATCH') return await updateTransfer(supabase, workspaceId, segments[3], body);
          if (method === 'DELETE') return await deleteTransfer(supabase, workspaceId, segments[3]);
        }
      }

      // /workspaces/:id/categories
      if (segments[2] === 'categories') {
        if (segments.length === 3) {
          if (method === 'GET') return await getCategories(supabase, workspaceId);
          if (method === 'POST') return await createCategory(supabase, workspaceId, user.id, body);
        }
        if (segments.length === 4 && method === 'PATCH') {
          return await updateCategory(supabase, workspaceId, segments[3], body);
        }
      }

      // /workspaces/:id/tags
      if (segments[2] === 'tags') {
        if (segments.length === 3) {
          if (method === 'GET') return await getTags(supabase, workspaceId);
          if (method === 'POST') return await createTag(supabase, workspaceId, user.id, body);
        }
        if (segments.length === 4 && method === 'PATCH') {
          return await updateTag(supabase, workspaceId, segments[3], body);
        }
      }
    }

    return errorResponse('Not found', 404);
  } catch (err) {
    console.error('API Error:', err.message);
    return errorResponse('Internal server error', 500);
  }
});
