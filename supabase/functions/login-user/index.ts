import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { consumeRateLimit, opaqueClientSubject, opaqueValue } from '../_shared/rateLimit.ts';
import { corsHeaders, withCors } from '../_shared/cors.ts';
import { recordSecurityEventSafely } from '../_shared/securityEvents.ts';
import { PayloadTooLargeError, readJsonWithLimit } from '../_shared/abuseProtection.js';
const MAX_REQUEST_BYTES = 8 * 1024;

const response = (body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, ...headers, 'Content-Type': 'application/json' },
});

Deno.serve(withCors(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405);

  let body: Record<string, unknown>;
  try {
    const parsed = await readJsonWithLimit(req, MAX_REQUEST_BYTES);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new SyntaxError('Invalid JSON body');
    body = parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return response({ error: 'Запрос слишком большой' }, 413);
    return response({ error: 'Некорректный запрос' }, 400);
  }
  const { identifier, password, captchaToken } = body;
  const normalized = typeof identifier === 'string' ? identifier.trim().toLowerCase() : '';
  if (!/^[\p{L}\p{N}_]{3,30}$/u.test(normalized) || typeof password !== 'string') {
    return response({ error: 'Неверное имя аккаунта или пароль' }, 400);
  }
  const normalizedCaptchaToken = typeof captchaToken === 'string' ? captchaToken.trim() : '';
  if (!normalizedCaptchaToken || normalizedCaptchaToken.length > 2048) {
    return response({ error: 'Не удалось пройти проверку безопасности' }, 400);
  }

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  let identifierSubject = '';
  try {
    const subjects = await Promise.all([
      opaqueClientSubject(req),
      opaqueValue(normalized),
    ]);
    const [clientSubject] = subjects;
    identifierSubject = subjects[1];
    const [clientAllowed, identifierAllowed] = await Promise.all([
      consumeRateLimit(admin, 'login:ip', clientSubject, 20, 300),
      consumeRateLimit(admin, 'login:identifier', identifierSubject, 10, 300),
    ]);
    if (!clientAllowed || !identifierAllowed) {
      await recordSecurityEventSafely(admin, {
        eventType: 'auth.login_username',
        outcome: 'blocked',
        subjectHash: identifierSubject,
        metadata: { reason: 'rate_limit' },
      }, req);
      return response({ error: 'Слишком много попыток. Повторите через несколько минут' }, 429, { 'Retry-After': '300' });
    }
  } catch {
    return response({ error: 'Вход временно недоступен' }, 503);
  }
  const { data: profile } = await admin
    .from('profiles')
    .select('user_id')
    .ilike('username', normalized)
    .maybeSingle();
  if (!profile) {
    await recordSecurityEventSafely(admin, {
      eventType: 'auth.login_username',
      outcome: 'failure',
      subjectHash: identifierSubject,
      metadata: { reason: 'invalid_credentials' },
    }, req);
    return response({ error: 'Неверное имя аккаунта или пароль' }, 400);
  }

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(profile.user_id);
  if (userError || !userData.user?.email) {
    await recordSecurityEventSafely(admin, {
      eventType: 'auth.login_username',
      outcome: 'failure',
      actorUserId: profile.user_id,
      subjectHash: identifierSubject,
      metadata: { reason: 'invalid_credentials' },
    }, req);
    return response({ error: 'Неверное имя аккаунта или пароль' }, 400);
  }

  const publicClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '');
  const { data, error } = await publicClient.auth.signInWithPassword({
    email: userData.user.email,
    password,
    options: { captchaToken: normalizedCaptchaToken },
  });
  if (error || !data.session) {
    await recordSecurityEventSafely(admin, {
      eventType: 'auth.login_username',
      outcome: 'failure',
      actorUserId: profile.user_id,
      subjectHash: identifierSubject,
      metadata: { reason: /captcha|turnstile|challenge/i.test(String(error?.message || '')) ? 'captcha' : 'invalid_credentials' },
    }, req);
    if (/captcha|turnstile|challenge/i.test(String(error?.message || ''))) {
      return response({ error: 'Не удалось пройти проверку безопасности' }, 400);
    }
    return response({ error: 'Неверное имя аккаунта или пароль' }, 400);
  }

  await recordSecurityEventSafely(admin, {
    eventType: 'auth.login_username',
    outcome: 'success',
    actorUserId: profile.user_id,
    subjectHash: identifierSubject,
  }, req);

  return response({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
}));
