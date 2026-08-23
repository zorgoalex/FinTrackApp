import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { withCors } from '../_shared/cors.ts';
import { PayloadTooLargeError, readJsonWithLimit } from '../_shared/abuseProtection.js';
import { consumeRateLimit, opaqueValue } from '../_shared/rateLimit.ts';
import { recordSecurityEventSafely } from '../_shared/securityEvents.ts';

const FORMAT = 'fintrack-account-privacy-export';
const VERSION = 1;
const PAGE_SIZE = 1000;
const MAX_REQUEST_BYTES = 1024;
const MAX_TOTAL_ROWS = 100_000;
const MAX_EXPORT_BYTES = 32 * 1024 * 1024;
const EXPORTS_PER_DAY = 3;

type QueryClient = ReturnType<typeof createClient>;
type Row = Record<string, unknown>;
type QueryFilter = (query: any) => any;
type ExportBudget = { rows: number };

class ExportLimitError extends Error {}
class ExportQueryError extends Error {}

const OWNED_WORKSPACE_TABLES = [
  ['accounts', 'accounts', 'workspace_id', 'id'],
  ['categories', 'categories', 'workspace_id', 'id'],
  ['tags', 'tags', 'workspace_id', 'id'],
  ['counterparties', 'counterparties', 'workspace_id', 'id'],
  ['operations', 'operations', 'workspace_id', 'id'],
  ['operation_allocations', 'operationAllocations', 'workspace_id', 'id'],
  ['scheduled_operations', 'scheduledOperations', 'workspace_id', 'id'],
  ['debts', 'debts', 'workspace_id', 'id'],
  ['exchange_rates', 'exchangeRates', 'workspace_id', 'id'],
  ['budgets', 'budgets', 'workspace_id', 'id'],
  ['import_sessions', 'importSessions', 'workspace_id', 'id'],
  ['import_templates', 'importTemplates', 'workspace_id', 'id'],
  ['category_rules', 'categoryRules', 'workspace_id', 'id'],
  ['cashflow_plans', 'cashflowPlans', 'workspace_id', 'id'],
  ['operation_comments', 'operationComments', 'workspace_id', 'id'],
  ['savings_goals', 'savingsGoals', 'workspace_id', 'id'],
  ['savings_goal_contributions', 'savingsGoalContributions', 'workspace_id', 'id'],
  ['operation_status_events', 'operationStatusEvents', 'workspace_id', 'id'],
] as const;

const SHARED_ACTIVITY_TABLES = [
  ['operations', 'operations', 'user_id', 'id'],
  ['scheduled_operations', 'scheduledOperations', 'user_id', 'id'],
  ['budgets', 'budgets', 'created_by', 'id'],
  ['debts', 'debts', 'created_by', 'id'],
  ['import_sessions', 'importSessions', 'created_by', 'id'],
  ['import_templates', 'importTemplates', 'created_by', 'id'],
  ['category_rules', 'categoryRules', 'created_by', 'id'],
  ['cashflow_plans', 'cashflowPlans', 'created_by', 'id'],
  ['operation_comments', 'operationComments', 'author_id', 'id'],
  ['savings_goals', 'savingsGoals', 'created_by', 'id'],
  ['savings_goal_contributions', 'savingsGoalContributions', 'created_by', 'id'],
  ['operation_status_events', 'operationStatusEvents', 'actor_id', 'id'],
] as const;

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

function countRows(budget: ExportBudget, rows: Row[]) {
  budget.rows += rows.length;
  if (budget.rows > MAX_TOTAL_ROWS) throw new ExportLimitError('row limit');
}

async function fetchAll(
  client: QueryClient,
  table: string,
  columns: string,
  orderColumn: string,
  filter: QueryFilter,
  budget: ExportBudget,
) {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = client.from(table).select(columns).order(orderColumn, { ascending: true });
    query = filter(query).range(from, from + PAGE_SIZE - 1);
    const { data, error } = await query;
    if (error) {
      console.error('privacy-export query failed', table, error.code || 'unknown');
      throw new ExportQueryError(table);
    }
    const page = (data || []) as Row[];
    countRows(budget, page);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchOperationTags(client: QueryClient, operationIds: string[], budget: ExportBudget) {
  const rows: Row[] = [];
  for (let index = 0; index < operationIds.length; index += 500) {
    const ids = operationIds.slice(index, index + 500);
    if (ids.length === 0) continue;
    const { data, error } = await client
      .from('operation_tags')
      .select('operation_id,tag_id')
      .in('operation_id', ids)
      .order('operation_id', { ascending: true });
    if (error) {
      console.error('privacy-export query failed', 'operation_tags', error.code || 'unknown');
      throw new ExportQueryError('operation_tags');
    }
    const page = (data || []) as Row[];
    countRows(budget, page);
    rows.push(...page);
  }
  return rows;
}

async function fetchByIds(
  client: QueryClient,
  table: string,
  idColumn: string,
  ids: unknown[],
  budget: ExportBudget,
) {
  const rows: Row[] = [];
  for (let index = 0; index < ids.length; index += 500) {
    rows.push(...await fetchAll(
      client,
      table,
      '*',
      'id',
      (query) => query.in(idColumn, ids.slice(index, index + 500)),
      budget,
    ));
  }
  return rows;
}

function publicWorkspace(workspace: Row, userId: string) {
  return {
    id: workspace.id,
    name: workspace.name,
    isPersonal: workspace.is_personal,
    workspaceType: workspace.workspace_type,
    baseCurrency: workspace.base_currency,
    autoFetchRates: workspace.auto_fetch_rates,
    quickButtons: workspace.quick_buttons,
    createdAt: workspace.created_at,
    updatedAt: workspace.updated_at,
    isOwned: workspace.owner_id === userId,
  };
}

function accountDocument(user: any) {
  const providers = Array.isArray(user.app_metadata?.providers)
    ? user.app_metadata.providers.filter((value: unknown) => typeof value === 'string').slice(0, 20)
    : [];
  return {
    id: user.id,
    email: user.email || null,
    phone: user.phone || null,
    createdAt: user.created_at || null,
    updatedAt: user.updated_at || null,
    lastSignInAt: user.last_sign_in_at || null,
    emailConfirmedAt: user.email_confirmed_at || null,
    phoneConfirmedAt: user.phone_confirmed_at || null,
    providers,
  };
}

async function buildOwnedWorkspace(client: QueryClient, workspace: Row, userId: string, budget: ExportBudget) {
  const data: Record<string, Row[]> = {};
  for (const [table, key, workspaceColumn, orderColumn] of OWNED_WORKSPACE_TABLES) {
    data[key] = await fetchAll(client, table, '*', orderColumn, (query) => query.eq(workspaceColumn, workspace.id), budget);
  }
  data.operationSplitGroups = await fetchAll(
    client,
    'operation_split_groups',
    '*',
    'id',
    (query) => query.eq('source_workspace_id', workspace.id),
    budget,
  );
  data.operationTags = await fetchOperationTags(
    client,
    (data.operations || []).map((row) => String(row.id)),
    budget,
  );
  return { workspace: publicWorkspace(workspace, userId), data };
}

async function buildSharedActivity(client: QueryClient, workspace: Row, userId: string, budget: ExportBudget) {
  const data: Record<string, Row[]> = {};
  for (const [table, key, actorColumn, orderColumn] of SHARED_ACTIVITY_TABLES) {
    data[key] = await fetchAll(client, table, '*', orderColumn, (query) => query
      .eq('workspace_id', workspace.id)
      .eq(actorColumn, userId), budget);
  }
  data.operationSplitGroups = await fetchAll(
    client,
    'operation_split_groups',
    '*',
    'id',
    (query) => query.eq('source_workspace_id', workspace.id).eq('created_by', userId),
    budget,
  );
  data.operationTags = await fetchOperationTags(
    client,
    (data.operations || []).map((row) => String(row.id)),
    budget,
  );
  const operationIds = (data.operations || []).map((row) => row.id).slice(0, MAX_TOTAL_ROWS);
  data.operationAllocations = await fetchByIds(
    client,
    'operation_allocations',
    'operation_id',
    operationIds,
    budget,
  );
  return { workspace: publicWorkspace(workspace, userId), data };
}

async function buildExport(client: QueryClient, user: any) {
  const budget: ExportBudget = { rows: 0 };
  const memberships = await fetchAll(
    client,
    'workspace_members',
    'workspace_id,role,invited_at,joined_at,last_accessed_at,is_active',
    'workspace_id',
    (query) => query.eq('user_id', user.id),
    budget,
  );
  const workspaceIds = memberships.map((row) => row.workspace_id).filter(Boolean);
  const workspaces = workspaceIds.length === 0 ? [] : await fetchAll(
    client,
    'workspaces',
    'id,owner_id,name,is_personal,workspace_type,base_currency,auto_fetch_rates,quick_buttons,created_at,updated_at',
    'id',
    (query) => query.in('id', workspaceIds),
    budget,
  );

  const ownedWorkspaces = [];
  const sharedWorkspaceActivity = [];
  for (const workspace of workspaces) {
    if (workspace.owner_id === user.id) {
      ownedWorkspaces.push(await buildOwnedWorkspace(client, workspace, user.id, budget));
    } else {
      sharedWorkspaceActivity.push(await buildSharedActivity(client, workspace, user.id, budget));
    }
  }

  const profile = await fetchAll(client, 'profiles', 'username,display_name,created_at,updated_at', 'created_at', (query) => query.eq('user_id', user.id), budget);
  const dashboardPreferences = await fetchAll(client, 'dashboard_preferences', '*', 'workspace_id', (query) => query.eq('user_id', user.id), budget);
  const notificationPreferences = await fetchAll(client, 'notification_preferences', '*', 'workspace_id', (query) => query.eq('user_id', user.id), budget);
  const notifications = await fetchAll(
    client,
    'app_notifications',
    'id,workspace_id,source_type,source_id,event_date,reminder_offset,title,body,severity,in_app_visible,read_at,telegram_sent_at,push_sent_at,email_sent_at,created_at',
    'id',
    (query) => query.eq('user_id', user.id),
    budget,
  );
  const pushDevices = await fetchAll(
    client,
    'push_subscriptions',
    'id,workspace_id,user_agent,last_seen_at,created_at,updated_at',
    'id',
    (query) => query.eq('user_id', user.id),
    budget,
  );
  const aiActivity = await fetchAll(
    client,
    'ai_assistant_logs',
    'id,workspace_id,model,status,prompt_tokens,completion_tokens,error_code,created_at',
    'id',
    (query) => query.eq('user_id', user.id),
    budget,
  );
  const offlineReceipts = await fetchAll(
    client,
    'offline_operation_requests',
    'client_request_id,workspace_id,operation_id,created_at,synced_at',
    'client_request_id',
    (query) => query.eq('user_id', user.id),
    budget,
  );
  const invitations = user.email ? await fetchAll(
    client,
    'workspace_invitations',
    'id,workspace_id,invited_email,role,status,invited_at,expires_at,accepted_at,declined_at,created_at,updated_at,email_sent_at,email_sent_count,last_reminded_at',
    'id',
    (query) => query.ilike('invited_email', user.email),
    budget,
  ) : [];
  const { data: telegramStatus, error: telegramError } = await client.rpc('get_my_telegram_link_status');
  if (telegramError) throw new ExportQueryError('telegram_status');
  const { data: securityEvents, error: securityError } = await client.rpc('get_my_privacy_security_events');
  if (securityError) throw new ExportQueryError('security_events');
  countRows(budget, (securityEvents || []) as Row[]);

  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    scope: 'Current account, user-owned workspace data, and the current user activity in shared workspaces.',
    account: accountDocument(user),
    profile: profile[0] || null,
    memberships,
    invitationsReceived: invitations,
    preferences: { dashboard: dashboardPreferences, notifications: notificationPreferences },
    notifications,
    connectedServices: { telegram: telegramStatus || [], webPushDevices: pushDevices },
    activity: { aiAssistant: aiActivity, offlineOperationReceipts: offlineReceipts, securityEvents: securityEvents || [] },
    ownedWorkspaces,
    sharedWorkspaceActivity,
    statistics: { exportedRows: budget.rows },
    exclusions: [
      'Passwords, password proofs, JWTs, CAPTCHA values, cookies and API keys.',
      'Web Push endpoints and encryption keys (p256dh/auth).',
      'Invitation and Telegram one-time tokens.',
      'Other members personal profiles and membership history.',
      'Raw AI questions; only bounded technical usage metadata is included.',
    ],
  };
}

Deno.serve(withCors(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

  const url = Deno.env.get('SUPABASE_URL') || '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!url || !anonKey || !serviceRoleKey) return json({ error: 'Service unavailable' }, 503);

  let body;
  try {
    body = await readJsonWithLimit(request, MAX_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return json({ error: 'Payload too large' }, 413);
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (body?.format !== 'json' || Object.keys(body).some((key) => key !== 'format')) {
    return json({ error: 'Invalid export request' }, 400);
  }

  const userClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: authorization } },
  });
  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json({ error: 'Unauthorized' }, 401);

  const userId = authData.user.id;
  const { data: authorized, error: authorizationError } = await userClient.rpc('authorize_my_privacy_export');
  if (authorizationError || authorized !== true) {
    await recordSecurityEventSafely(admin, {
      eventType: 'data.export.account', outcome: 'blocked', actorUserId: userId,
      metadata: { reason: 'fresh_password_required' },
    }, request);
    return json({ error: 'Повторно подтвердите текущий пароль' }, 403);
  }

  try {
    const subject = await opaqueValue(userId);
    if (!await consumeRateLimit(admin, 'privacy-export:user', subject, EXPORTS_PER_DAY, 86400)) {
      await recordSecurityEventSafely(admin, {
        eventType: 'data.export.account', outcome: 'blocked', actorUserId: userId,
        metadata: { reason: 'rate_limit' },
      }, request);
      return json({ error: 'Лимит: не более трёх экспортов за 24 часа' }, 429, { 'Retry-After': '86400' });
    }
  } catch {
    return json({ error: 'Service unavailable' }, 503);
  }

  try {
    const document = await buildExport(userClient, authData.user);
    const payload = new TextEncoder().encode(JSON.stringify(document, null, 2));
    if (payload.byteLength > MAX_EXPORT_BYTES) throw new ExportLimitError('byte limit');
    await recordSecurityEventSafely(admin, {
      eventType: 'data.export.account', outcome: 'success', actorUserId: userId,
      metadata: {
        format: 'json', bytes: payload.byteLength, rows: document.statistics.exportedRows,
        owned_workspaces: document.ownedWorkspaces.length,
        shared_workspaces: document.sharedWorkspaceActivity.length,
      },
    }, request);
    const day = document.exportedAt.slice(0, 10);
    return new Response(payload, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="fintrack_my_data_${day}.json"`,
        'Cache-Control': 'no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    const isLimit = error instanceof ExportLimitError;
    await recordSecurityEventSafely(admin, {
      eventType: 'data.export.account', outcome: isLimit ? 'blocked' : 'failure', actorUserId: userId,
      metadata: { reason: isLimit ? 'export_limit' : 'export_failed' },
    }, request);
    return json({
      error: isLimit
        ? 'Экспорт превышает безопасный лимит. Скачайте отдельные резервные копии пространств.'
        : 'Не удалось подготовить экспорт данных',
    }, isLimit ? 413 : 500);
  }
}));
