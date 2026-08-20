// deno-lint-ignore-file no-import-prefix
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { consumeRateLimit, opaqueClientSubject, opaqueValue } from '../_shared/rateLimit.ts';
import {
  checkPwnedPassword,
  PASSWORD_CHECK_UNAVAILABLE_MESSAGE,
  PWNED_PASSWORD_MESSAGE,
} from '../_shared/passwordSecurity.js';

const PROOF_FIELD = '_password_policy_proof';

type QueryResult = PromiseLike<{ data?: unknown; error: unknown }>;
type ProofQuery = {
  delete: () => ProofQuery;
  lt: (column: string, value: string) => QueryResult;
  eq: (column: string, value: string) => QueryResult;
  insert: (values: Record<string, unknown>) => QueryResult;
};
type AdminClient = {
  from: (table: string) => ProofQuery;
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  auth: {
    getUser: (token: string) => PromiseLike<{
      data: { user?: { id?: string; email?: string | null } };
      error: unknown;
    }>;
  };
};
const ALLOWED_REDIRECT_ORIGINS = new Set([
  'https://fintrackapp.vip',
  'https://fintrackapp-wheat.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

const passwordIsStrong = (password: unknown): password is string => typeof password === 'string'
  && password.length >= 8
  && password.length <= 128
  && /[a-z]/.test(password)
  && /[A-Z]/.test(password)
  && /\d/.test(password);

const passwordPolicyMessage = 'Пароль должен содержать от 8 до 128 символов, строчную и заглавную латинские буквы и цифру';

function response(req: Request, body: Record<string, unknown>, status = 200) {
  const requestOrigin = req.headers.get('origin') || '';
  const allowOrigin = ALLOWED_REDIRECT_ORIGINS.has(requestOrigin) ? requestOrigin : 'https://fintrackapp.vip';
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Content-Type': 'application/json',
      Vary: 'Origin',
    },
  });
}

async function readJson(req: Request) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

async function issueProof(
  admin: AdminClient,
  purpose: 'signup' | 'update',
  { email, userId }: { email?: string; userId?: string } = {},
) {
  const token = crypto.randomUUID();
  const now = new Date();
  await admin.from('password_policy_proofs').delete().lt('expires_at', now.toISOString());
  const { error } = await admin.from('password_policy_proofs').insert({
    token,
    purpose,
    email: email || null,
    user_id: userId || null,
    expires_at: new Date(now.getTime() + 60_000).toISOString(),
  });
  if (error) throw new Error('Password proof creation failed');
  return token;
}

async function revokeProof(admin: AdminClient, token: string) {
  await admin.from('password_policy_proofs').delete().eq('token', token);
}

async function enforcePwnedPassword(password: string) {
  const result = await checkPwnedPassword(password);
  if (result.pwned) {
    const error = new Error(PWNED_PASSWORD_MESSAGE) as Error & { code?: string };
    error.code = 'PWNED_PASSWORD';
    throw error;
  }
}

function authToken(req: Request) {
  const authorization = req.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

function jwtHasFreshRecoveryMethod(token: string) {
  try {
    const encoded = token.split('.')[1] || '';
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    const claims = JSON.parse(atob(normalized));
    const cutoff = Math.floor(Date.now() / 1000) - 15 * 60;
    return Array.isArray(claims?.amr) && claims.amr.some((entry: { method?: string; timestamp?: number }) => (
      ['otp', 'magiclink', 'recovery'].includes(entry?.method || '')
      && Number.isFinite(entry?.timestamp)
      && Number(entry.timestamp) >= cutoff
    ));
  } catch {
    return false;
  }
}

async function handleSignup(
  req: Request,
  body: Record<string, unknown>,
  admin: AdminClient,
  url: string,
  anonKey: string,
) {
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = body.password;
  const captchaToken = typeof body.captchaToken === 'string' ? body.captchaToken.trim() : '';
  const redirectOrigin = typeof body.redirectOrigin === 'string' ? body.redirectOrigin.trim() : '';

  if (!/^[\p{L}\p{N}_]{3,21}$/u.test(username) || !/^\S+@\S+\.\S+$/.test(email) || email.length > 254) {
    return response(req, { error: 'Проверьте логин и email' }, 400);
  }
  if (!passwordIsStrong(password)) return response(req, { error: passwordPolicyMessage }, 400);
  if (!captchaToken || captchaToken.length > 2048) {
    return response(req, { error: 'Не удалось пройти проверку безопасности' }, 400);
  }
  if (!ALLOWED_REDIRECT_ORIGINS.has(redirectOrigin)) {
    return response(req, { error: 'Недопустимый адрес возврата' }, 400);
  }

  try {
    const [clientSubject, emailSubject] = await Promise.all([opaqueClientSubject(req), opaqueValue(email)]);
    const [clientAllowed, emailAllowed] = await Promise.all([
      consumeRateLimit(admin, 'password-signup:ip', clientSubject, 10, 300),
      consumeRateLimit(admin, 'password-signup:email', emailSubject, 3, 600),
    ]);
    if (!clientAllowed || !emailAllowed) {
      return response(req, { error: 'Слишком много попыток. Повторите через несколько минут' }, 429);
    }
  } catch {
    return response(req, { error: 'Регистрация временно недоступна' }, 503);
  }

  try {
    await enforcePwnedPassword(password);
  } catch (error) {
    if ((error as { code?: string }).code === 'PWNED_PASSWORD') return response(req, { error: PWNED_PASSWORD_MESSAGE }, 422);
    return response(req, { error: PASSWORD_CHECK_UNAVAILABLE_MESSAGE }, 503);
  }

  let proof = '';
  try {
    proof = await issueProof(admin, 'signup', { email });
    const publicClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await publicClient.auth.signUp({
      email,
      password,
      options: {
        data: { name: username, username, [PROOF_FIELD]: proof },
        emailRedirectTo: redirectOrigin,
        captchaToken,
      },
    });
    if (error) {
      await revokeProof(admin, proof);
      const message = /captcha|turnstile|challenge/i.test(error.message)
        ? 'Не удалось пройти проверку безопасности'
        : error.message || 'Ошибка регистрации';
      return response(req, { error: message }, 400);
    }
    return response(req, {
      success: true,
      requiresEmailConfirmation: !data.session,
      access_token: data.session?.access_token || null,
      refresh_token: data.session?.refresh_token || null,
    });
  } catch {
    if (proof) await revokeProof(admin, proof);
    return response(req, { error: 'Регистрация временно недоступна' }, 503);
  }
}

async function handleUpdate(
  req: Request,
  body: Record<string, unknown>,
  admin: AdminClient,
  url: string,
  anonKey: string,
) {
  const password = body.password;
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  if (!passwordIsStrong(password)) return response(req, { error: passwordPolicyMessage }, 400);

  const accessToken = authToken(req);
  if (!accessToken) return response(req, { error: 'Требуется повторный вход' }, 401);
  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user?.id || !userData.user.email) {
    return response(req, { error: 'Сессия недействительна. Войдите снова.' }, 401);
  }
  const recoverySession = jwtHasFreshRecoveryMethod(accessToken);
  if (!recoverySession && !currentPassword) {
    return response(req, { error: 'Введите текущий пароль' }, 400);
  }

  try {
    const userSubject = await opaqueValue(userData.user.id);
    const allowed = await consumeRateLimit(admin, 'password-update:user', userSubject, 5, 900);
    if (!allowed) return response(req, { error: 'Слишком много попыток. Повторите позже' }, 429);
  } catch {
    return response(req, { error: 'Смена пароля временно недоступна' }, 503);
  }

  try {
    await enforcePwnedPassword(password);
  } catch (error) {
    if ((error as { code?: string }).code === 'PWNED_PASSWORD') return response(req, { error: PWNED_PASSWORD_MESSAGE }, 422);
    return response(req, { error: PASSWORD_CHECK_UNAVAILABLE_MESSAGE }, 503);
  }

  let proof = '';
  try {
    proof = await issueProof(admin, 'update', { userId: userData.user.id });
    const updateResponse = await fetch(`${url}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        password,
        ...(currentPassword ? { current_password: currentPassword } : {}),
        data: { [PROOF_FIELD]: proof },
      }),
    });
    const payload = await updateResponse.json().catch(() => ({}));
    if (!updateResponse.ok) {
      await revokeProof(admin, proof);
      const rawMessage = String(payload?.msg || payload?.message || '');
      const message = /current password/i.test(rawMessage)
        ? 'Текущий пароль неверен.'
        : rawMessage || 'Не удалось изменить пароль';
      return response(req, { error: message }, updateResponse.status >= 400 && updateResponse.status < 500 ? updateResponse.status : 503);
    }
    return response(req, { success: true });
  } catch {
    if (proof) await revokeProof(admin, proof);
    return response(req, { error: 'Смена пароля временно недоступна' }, 503);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return response(req, {}, 200);
  if (req.method !== 'POST') return response(req, { error: 'Method not allowed' }, 405);

  const body = await readJson(req);
  if (!body || typeof body !== 'object') return response(req, { error: 'Некорректный запрос' }, 400);

  const url = Deno.env.get('SUPABASE_URL') || '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!url || !anonKey || !serviceRoleKey) return response(req, { error: 'Сервис временно недоступен' }, 503);
  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) as unknown as AdminClient;

  if (body.action === 'signup') return handleSignup(req, body, admin, url, anonKey);
  if (body.action === 'update') return handleUpdate(req, body, admin, url, anonKey);
  return response(req, { error: 'Неизвестное действие' }, 400);
});
