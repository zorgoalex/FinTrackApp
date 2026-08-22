import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, withCors } from '../_shared/cors.ts';
import { consumeRateLimit, opaqueValue } from '../_shared/rateLimit.ts';
import { recordSecurityEventSafely } from '../_shared/securityEvents.ts';
import { PayloadTooLargeError, readJsonWithLimit } from '../_shared/abuseProtection.js';

const MAX_REQUEST_BYTES = 2 * 1024;

const EVENT_ROLES = new Map([
  ['data.export.operations', new Set(['Owner', 'Admin', 'Member'])],
  ['data.export.analytics', new Set(['Owner', 'Admin', 'Member'])],
  ['workspace.backup_download', new Set(['Owner', 'Admin'])],
]);

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...headers, 'Content-Type': 'application/json' },
  });
}

Deno.serve(withCors(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

  const url = Deno.env.get('SUPABASE_URL') || '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!url || !anonKey || !serviceRoleKey) return json({ error: 'Service unavailable' }, 503);

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json({ error: 'Unauthorized' }, 401);

  let body;
  try {
    body = await readJsonWithLimit(request, MAX_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return json({ error: 'Payload too large' }, 413);
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const eventType = typeof body?.eventType === 'string' ? body.eventType.trim() : '';
  const workspaceId = typeof body?.workspaceId === 'string' ? body.workspaceId.trim() : '';
  const allowedRoles = EVENT_ROLES.get(eventType);
  if (!allowedRoles || !/^[0-9a-f-]{36}$/i.test(workspaceId)) return json({ error: 'Invalid event' }, 400);

  const { data: membership, error: membershipError } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', authData.user.id)
    .eq('is_active', true)
    .maybeSingle();
  if (membershipError || !membership || !allowedRoles.has(membership.role)) {
    return json({ error: 'Forbidden' }, 403);
  }

  try {
    const userSubject = await opaqueValue(authData.user.id);
    if (!await consumeRateLimit(admin, 'security-event:user', userSubject, 30, 3600)) {
      return json({ error: 'Too many events' }, 429, { 'Retry-After': '3600' });
    }
  } catch {
    return json({ error: 'Service unavailable' }, 503);
  }

  const recorded = await recordSecurityEventSafely(admin, {
    eventType,
    outcome: 'success',
    actorUserId: authData.user.id,
    workspaceId,
    source: 'client',
  }, request);
  if (!recorded) return json({ error: 'Service unavailable' }, 503);
  return new Response(null, { status: 204, headers: corsHeaders });
}));
