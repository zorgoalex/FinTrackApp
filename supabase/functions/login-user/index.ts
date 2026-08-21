import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { consumeRateLimit, opaqueClientSubject, opaqueValue } from '../_shared/rateLimit.ts';
import { corsHeaders, withCors } from '../_shared/cors.ts';

const response = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

Deno.serve(withCors(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405);

  const { identifier, password, captchaToken } = await req.json();
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
  try {
    const [clientSubject, identifierSubject] = await Promise.all([
      opaqueClientSubject(req),
      opaqueValue(normalized),
    ]);
    const [clientAllowed, identifierAllowed] = await Promise.all([
      consumeRateLimit(admin, 'login:ip', clientSubject, 20, 300),
      consumeRateLimit(admin, 'login:identifier', identifierSubject, 10, 300),
    ]);
    if (!clientAllowed || !identifierAllowed) {
      return response({ error: 'Слишком много попыток. Повторите через несколько минут' }, 429);
    }
  } catch {
    return response({ error: 'Вход временно недоступен' }, 503);
  }
  const { data: profile } = await admin
    .from('profiles')
    .select('user_id')
    .ilike('username', normalized)
    .maybeSingle();
  if (!profile) return response({ error: 'Неверное имя аккаунта или пароль' }, 400);

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(profile.user_id);
  if (userError || !userData.user?.email) return response({ error: 'Неверное имя аккаунта или пароль' }, 400);

  const publicClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '');
  const { data, error } = await publicClient.auth.signInWithPassword({
    email: userData.user.email,
    password,
    options: { captchaToken: normalizedCaptchaToken },
  });
  if (error || !data.session) {
    if (/captcha|turnstile|challenge/i.test(String(error?.message || ''))) {
      return response({ error: 'Не удалось пройти проверку безопасности' }, 400);
    }
    return response({ error: 'Неверное имя аккаунта или пароль' }, 400);
  }

  return response({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
}));
