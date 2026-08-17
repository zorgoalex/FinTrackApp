import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(path, 'utf8');

test('Turnstile widget uses explicit managed rendering and resets single-use tokens', async () => {
  const source = await read('src/components/TurnstileWidget.jsx');

  assert.match(source, /VITE_TURNSTILE_SITE_KEY/);
  assert.match(source, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/);
  assert.match(source, /appearance: 'interaction-only'/);
  assert.match(source, /execution: 'render'/);
  assert.match(source, /'expired-callback': \(\) => onTokenChangeRef\.current\?\.\(''\)/);
  assert.match(source, /turnstile\.reset\(widgetIdRef\.current\)/);
});

test('all password-based Auth flows propagate a fresh captchaToken', async () => {
  const auth = await read('src/contexts/AuthContext.jsx');
  const login = await read('src/pages/LoginPage.jsx');
  const signup = await read('src/pages/SignupPage.jsx');
  const forgot = await read('src/pages/ForgotPasswordPage.jsx');
  const stepUp = await read('src/components/PasswordStepUpForm.jsx');
  const profile = await read('src/pages/ProfilePage.jsx');

  assert.match(auth, /options: \{ captchaToken \}/);
  assert.match(auth, /body: \{ identifier: identifier\.trim\(\), password, captchaToken \}/);
  assert.match(auth, /emailRedirectTo: window\.location\.origin,[\s\S]*captchaToken/);
  assert.match(auth, /resetPasswordForEmail\(email,[\s\S]*captchaToken/);
  assert.match(login, /action="login"/);
  assert.match(signup, /action="signup"/);
  assert.match(forgot, /action="password_reset"/);
  assert.match(stepUp, /action="password_step_up"/);
  assert.match(profile, /action="delete_account"/);
  assert.match(profile, /options: \{ captchaToken: deleteCaptchaToken \}/);
});

test('username login forwards the token to Supabase Auth for one server-side validation', async () => {
  const edge = await read('supabase/functions/login-user/index.ts');

  assert.match(edge, /const \{ identifier, password, captchaToken \} = await req\.json\(\)/);
  assert.match(edge, /!normalizedCaptchaToken \|\| normalizedCaptchaToken\.length > 2048/);
  assert.match(edge, /options: \{ captchaToken: normalizedCaptchaToken \}/);
  assert.doesNotMatch(edge, /siteverify/);
});

test('production CSP and environment contract allow Turnstile without exposing its secret', async () => {
  const headers = await read('vercel.json');
  const envExample = await read('.env.example');
  const clientFiles = await Promise.all([
    read('src/components/TurnstileWidget.jsx'),
    read('src/contexts/AuthContext.jsx'),
  ]);

  assert.match(headers, /script-src[^;]+https:\/\/challenges\.cloudflare\.com/);
  assert.match(headers, /frame-src https:\/\/challenges\.cloudflare\.com/);
  assert.match(envExample, /VITE_TURNSTILE_SITE_KEY=/);
  assert.match(envExample, /# TURNSTILE_SECRET_KEY=/);
  assert.doesNotMatch(clientFiles.join('\n'), /TURNSTILE_SECRET_KEY/);
});
