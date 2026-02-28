import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

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

// --- Route Handlers ---

async function getWorkspaces(supabase: ReturnType<typeof createClient>) {
  const { data, error } = await supabase
    .from('workspace_members')
    .select('workspace_id, role, workspaces(id, name, is_personal, created_at)')
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

  let query = supabase
    .from('operations')
    .select('amount, type')
    .eq('workspace_id', workspaceId);

  if (dateFrom) query = query.gte('operation_date', dateFrom);
  if (dateTo) query = query.lte('operation_date', dateTo);

  const { data, error } = await query;
  if (error) return errorResponse(error.message, 500);

  let income = 0;
  let expense = 0;
  for (const op of data || []) {
    if (op.type === 'income' || op.type === 'salary') {
      income += Number(op.amount);
    } else {
      expense += Number(op.amount);
    }
  }

  return jsonResponse({ income, expense, balance: income - expense });
}

async function getOperations(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  url: URL,
) {
  const dateFrom = url.searchParams.get('dateFrom');
  const dateTo = url.searchParams.get('dateTo');
  const limit = parseInt(url.searchParams.get('limit') || '50', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

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
  const type = url.searchParams.get('type'); // income, expense, salary
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

  if (!amount || !type) {
    return errorResponse('amount and type are required', 400);
  }

  // If account_id not provided, use default account
  let resolvedAccountId = account_id;
  if (!resolvedAccountId) {
    const { data: defaultAcc } = await supabase
      .from('accounts')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('is_default', true)
      .single();
    resolvedAccountId = defaultAcc?.id || null;
  }

  const { data, error } = await supabase
    .from('operations')
    .insert({
      workspace_id: workspaceId,
      user_id: userId,
      amount,
      type,
      description: description || null,
      category_id: category_id || null,
      account_id: resolvedAccountId,
      operation_date: operation_date || new Date().toISOString().split('T')[0],
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
    if (tagError) console.error('Tag insert error:', tagError.message);
  }

  return jsonResponse(data, 201);
}

async function updateOperation(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  opId: string,
  body: Record<string, unknown>,
) {
  const { tag_ids, ...fields } = body;

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
