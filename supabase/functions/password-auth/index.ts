// deno-lint-ignore-file no-import-prefix
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { consumeRateLimit, opaqueClientSubject, opaqueValue } from '../_shared/rateLimit.ts';
import { corsHeaders, isAllowedRedirectOrigin, withCors } from '../_shared/cors.ts';
import { recordSecurityEventSafely } from '../_shared/securityEvents.ts';
import { PayloadTooLargeError, readJsonWithLimit } from '../_shared/abuseProtection.js';
import {
  checkPwnedPassword,
  PASSWORD_CHECK_UNAVAILABLE_MESSAGE,
  PWNED_PASSWORD_MESSAGE,
} from '../_shared/passwordSecurity.js';

const PROOF_FIELD = '_password_policy_proof';
const MAX_REQUEST_BYTES = 16 * 1024;

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
      data: { user?: { id?: string; email?: string | null; app_metadata?: Record<string, unknown> } };
      error: unknown;
    }>;
    admin: {
      updateUserById: (
        id: string,
        attributes: { password?: string; app_metadata?: Record<string, unknown> },
      ) => PromiseLike<{ data: { user?: unknown }; error: unknown }>;
    };
  };
};
const passwordIsStrong = (password: unknown): password is string => typeof password === 'string'
  && password.length >= 8
  && password.length <= 128
  && /[a-z]/.test(password)
  && /[A-Z]/.test(password)
  && /\d/.test(password);

const passwordPolicyMessage = 'Пароль должен содержать от 8 до 128 символов, строчную и заглавную латинские буквы и цифру';

function response(_req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

async function readJson(req: Request) {
  try {
    return await readJsonWithLimit(req, MAX_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) throw error;
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
  try {
    await admin.from('password_policy_proofs').delete().eq('token', token);
  } catch {
    // Proofs expire after one minute and are also purged before the next issue.
  }
}

async function restoreAppMetadata(
  admin: AdminClient,
  userId: string,
  appMetadata: Record<string, unknown>,
) {
  try {
    await admin.auth.admin.updateUserById(userId, { app_metadata: appMetadata });
  } catch {
    // The proof is revoked separately, so a stale marker cannot authorize a write.
  }
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

function jwtHasFreshPasswordAuthorization(token: string) {
  try {
    const encoded = token.split('.')[1] || '';
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    const claims = JSON.parse(atob(normalized));
    const now = Math.floor(Date.now() / 1000);
    return Array.isArray(claims?.amr) && claims.amr.some((entry: { method?: string; timestamp?: number }) => (
      Number.isFinite(entry?.timestamp)
      && (
        (entry?.method === 'password' && Number(entry.timestamp) >= now - 5 * 60)
        || (
          ['otp', 'magiclink', 'recovery'].includes(entry?.method || '')
          && Number(entry.timestamp) >= now - 15 * 60
        )
      )
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
  if (!isAllowedRedirectOrigin(req, redirectOrigin)) {
    return response(req, { error: 'Недопустимый адрес возврата' }, 400);
  }

  let emailSubject = '';
  try {
    const subjects = await Promise.all([opaqueClientSubject(req), opaqueValue(email)]);
    const [clientSubject] = subjects;
    emailSubject = subjects[1];
    const [clientAllowed, emailAllowed] = await Promise.all([
      consumeRateLimit(admin, 'password-signup:ip', clientSubject, 10, 300),
      consumeRateLimit(admin, 'password-signup:email', emailSubject, 3, 600),
    ]);
    if (!clientAllowed || !emailAllowed) {
      await recordSecurityEventSafely(admin, {
        eventType: 'auth.signup', outcome: 'blocked', subjectHash: emailSubject,
        metadata: { reason: 'rate_limit' },
      }, req);
      return response(req, { error: 'Слишком много попыток. Повторите через несколько минут' }, 429);
    }
  } catch {
    return response(req, { error: 'Регистрация временно недоступна' }, 503);
  }

  try {
    await enforcePwnedPassword(password);
  } catch (error) {
    if ((error as { code?: string }).code === 'PWNED_PASSWORD') {
      await recordSecurityEventSafely(admin, {
        eventType: 'auth.signup', outcome: 'blocked', subjectHash: emailSubject,
        metadata: { reason: 'breached_password' },
      }, req);
      return response(req, { error: PWNED_PASSWORD_MESSAGE }, 422);
    }
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
      await recordSecurityEventSafely(admin, {
        eventType: 'auth.signup', outcome: 'failure', subjectHash: emailSubject,
        metadata: { reason: /captcha|turnstile|challenge/i.test(error.message) ? 'captcha' : 'provider_rejected' },
      }, req);
      return response(req, { error: message }, 400);
    }
    await recordSecurityEventSafely(admin, {
      eventType: 'auth.signup', outcome: 'success', actorUserId: data.user?.id || null,
      subjectHash: emailSubject,
    }, req);
    return response(req, {
      success: true,
      requiresEmailConfirmation: !data.session,
      access_token: data.session?.access_token || null,
      refresh_token: data.session?.refresh_token || null,
    });
  } catch {
    if (proof) await revokeProof(admin, proof);
    await recordSecurityEventSafely(admin, {
      eventType: 'auth.signup', outcome: 'failure', subjectHash: emailSubject,
      metadata: { reason: 'service_error' },
    }, req);
    return response(req, { error: 'Регистрация временно недоступна' }, 503);
  }
}

async function handleUpdate(
  req: Request,
  body: Record<string, unknown>,
  admin: AdminClient,
) {
  const password = body.password;
  if (!passwordIsStrong(password)) return response(req, { error: passwordPolicyMessage }, 400);

  const accessToken = authToken(req);
  if (!accessToken) return response(req, { error: 'Требуется повторный вход' }, 401);
  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user?.id || !userData.user.email) {
    return response(req, { error: 'Сессия недействительна. Войдите снова.' }, 401);
  }
  if (!jwtHasFreshPasswordAuthorization(accessToken)) {
    return response(req, { error: 'Подтвердите текущий пароль ещё раз.' }, 401);
  }

  let userSubject = '';
  try {
    userSubject = await opaqueValue(userData.user.id);
    const allowed = await consumeRateLimit(admin, 'password-update:user', userSubject, 5, 900);
    if (!allowed) {
      await recordSecurityEventSafely(admin, {
        eventType: 'auth.password_update', outcome: 'blocked', actorUserId: userData.user.id,
        subjectHash: userSubject, metadata: { reason: 'rate_limit' },
      }, req);
      return response(req, { error: 'Слишком много попыток. Повторите позже' }, 429);
    }
  } catch {
    return response(req, { error: 'Смена пароля временно недоступна' }, 503);
  }

  try {
    await enforcePwnedPassword(password);
  } catch (error) {
    if ((error as { code?: string }).code === 'PWNED_PASSWORD') {
      await recordSecurityEventSafely(admin, {
        eventType: 'auth.password_update', outcome: 'blocked', actorUserId: userData.user.id,
        subjectHash: userSubject, metadata: { reason: 'breached_password' },
      }, req);
      return response(req, { error: PWNED_PASSWORD_MESSAGE }, 422);
    }
    return response(req, { error: PASSWORD_CHECK_UNAVAILABLE_MESSAGE }, 503);
  }

  let proof = '';
  let proofAttached = false;
  const originalAppMetadata = { ...(userData.user.app_metadata || {}) };
  delete originalAppMetadata[PROOF_FIELD];
  try {
    proof = await issueProof(admin, 'update', { userId: userData.user.id });
    const { error: attachError } = await admin.auth.admin.updateUserById(userData.user.id, {
      app_metadata: { ...originalAppMetadata, [PROOF_FIELD]: proof },
    });
    if (attachError) {
      await revokeProof(admin, proof);
      await recordSecurityEventSafely(admin, {
        eventType: 'auth.password_update', outcome: 'failure', actorUserId: userData.user.id,
        subjectHash: userSubject, metadata: { reason: 'proof_attach' },
      }, req);
      return response(req, { error: 'Не удалось подготовить безопасную смену пароля. Повторите попытку.' }, 503);
    }
    proofAttached = true;

    const { error: updateError } = await admin.auth.admin.updateUserById(userData.user.id, { password });
    if (updateError) {
      await revokeProof(admin, proof);
      await restoreAppMetadata(admin, userData.user.id, originalAppMetadata);
      await recordSecurityEventSafely(admin, {
        eventType: 'auth.password_update', outcome: 'failure', actorUserId: userData.user.id,
        subjectHash: userSubject, metadata: { reason: 'provider_rejected' },
      }, req);
      return response(req, { error: 'Не удалось изменить пароль. Повторите попытку.' }, 400);
    }
    await recordSecurityEventSafely(admin, {
      eventType: 'auth.password_update', outcome: 'success', actorUserId: userData.user.id,
      subjectHash: userSubject,
    }, req);
    return response(req, { success: true });
  } catch {
    if (proof) await revokeProof(admin, proof);
    if (proofAttached) {
      await restoreAppMetadata(admin, userData.user.id, originalAppMetadata);
    }
    await recordSecurityEventSafely(admin, {
      eventType: 'auth.password_update', outcome: 'failure', actorUserId: userData.user.id,
      subjectHash: userSubject || null, metadata: { reason: 'service_error' },
    }, req);
    return response(req, { error: 'Смена пароля временно недоступна' }, 503);
  }
}

Deno.serve(withCors(async (req: Request) => {
  if (req.method === 'OPTIONS') return response(req, {}, 200);
  if (req.method !== 'POST') return response(req, { error: 'Method not allowed' }, 405);

  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return response(req, { error: 'Запрос слишком большой' }, 413);
    throw error;
  }
  if (!body || typeof body !== 'object') return response(req, { error: 'Некорректный запрос' }, 400);

  const url = Deno.env.get('SUPABASE_URL') || '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!url || !anonKey || !serviceRoleKey) return response(req, { error: 'Сервис временно недоступен' }, 503);
  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) as unknown as AdminClient;

  if (body.action === 'signup') return handleSignup(req, body, admin, url, anonKey);
  if (body.action === 'update') return handleUpdate(req, body, admin);
  return response(req, { error: 'Неизвестное действие' }, 400);
}));
