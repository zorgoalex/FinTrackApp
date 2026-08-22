import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { corsHeaders, withCors } from '../_shared/cors.ts';
import { isAllowedWebPushEndpoint } from '../_shared/pushEndpoint.ts';
import { PayloadTooLargeError, readJsonWithLimit } from '../_shared/abuseProtection.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? '';
const MAX_REQUEST_BYTES = 2 * 1024;

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...headers, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

Deno.serve(withCors(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    return json({ error: 'Web Push delivery is not configured' }, 503);
  }

  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return json({ error: 'Authentication required' }, 401);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: userData, error: userError } = await admin.auth.getUser(authorization.slice(7));
  if (userError || !userData.user) return json({ error: 'Authentication failed' }, 401);

  let requestBody: Record<string, unknown>;
  try {
    const parsedBody = await readJsonWithLimit(request, MAX_REQUEST_BYTES);
    if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
      return json({ error: 'Invalid JSON body' }, 400);
    }
    requestBody = parsedBody as Record<string, unknown>;
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return json({ error: 'Payload too large' }, 413);
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const workspaceId = requestBody?.workspaceId;
  if (typeof workspaceId !== 'string' || !workspaceId) {
    return json({ error: 'workspaceId is required' }, 400);
  }

  const { data: membership, error: membershipError } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userData.user.id)
    .eq('is_active', true)
    .maybeSingle();
  if (membershipError) return json({ error: 'Could not verify workspace access' }, 500);
  if (!membership) return json({ error: 'Workspace access denied' }, 403);

  const { data: withinLimit, error: rateLimitError } = await admin.rpc('consume_security_rate_limit', {
    p_bucket: 'push:test',
    p_subject: userData.user.id,
    p_limit: 5,
    p_window_seconds: 3600,
  });
  if (rateLimitError) return json({ error: 'Could not check request limit' }, 500);
  if (!withinLimit) return json({ error: 'Too many test notifications' }, 429, { 'Retry-After': '3600' });

  const { data, error: subscriptionsError } = await admin
    .from('push_subscriptions')
    .select('id,endpoint,p256dh,auth')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userData.user.id)
    .limit(5);
  if (subscriptionsError) return json({ error: 'Could not load Web Push subscription' }, 500);

  const subscriptions = (data || []) as PushSubscriptionRow[];
  if (!subscriptions.length) return json({ error: 'Web Push subscription not found' }, 404);

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  let delivered = 0;
  for (const subscription of subscriptions) {
    if (!isAllowedWebPushEndpoint(subscription.endpoint)) {
      await admin.from('push_subscriptions').delete().eq('id', subscription.id).eq('user_id', userData.user.id);
      continue;
    }
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, JSON.stringify({
        title: 'FinTrackApp · тест уведомлений',
        body: 'Web Push работает. Тест отправлен только на ваши устройства.',
        tag: `fintrack-test-${userData.user.id}`,
        url: `/workspace/${workspaceId}`,
      }), { TTL: 60, timeout: 10_000 });
      delivered += 1;
    } catch (pushError) {
      const statusCode = Number((pushError as { statusCode?: number }).statusCode || 0);
      if (statusCode === 404 || statusCode === 410) {
        await admin.from('push_subscriptions').delete().eq('id', subscription.id);
      }
    }
  }

  if (!delivered) return json({ error: 'Web Push delivery failed' }, 502);
  return json({ ok: true, delivered });
}));
