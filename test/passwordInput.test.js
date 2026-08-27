import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageFiles = [
  'src/pages/LoginPage.jsx',
  'src/pages/SignupPage.jsx',
  'src/pages/ResetPasswordPage.jsx',
  'src/pages/ProfilePage.jsx',
];

test('password fields expose an accessible show and hide control', async () => {
  const component = await readFile('src/components/PasswordInput.jsx', 'utf8');
  assert.match(component, /visible \? 'text' : 'password'/);
  assert.match(component, /Показать пароль/);
  assert.match(component, /Скрыть пароль/);
  assert.match(component, /aria-pressed=\{visible\}/);

  for (const file of pageFiles) {
    const source = await readFile(file, 'utf8');
    assert.match(source, /<PasswordInput/);
    assert.doesNotMatch(source, /type=["']password["']/);
  }
});

test('signup requires matching password confirmation before submission', async () => {
  const source = await readFile('src/pages/SignupPage.jsx', 'utf8');

  assert.match(source, /passwordConfirmation/);
  assert.match(source, /password !== passwordConfirmation/);
  assert.match(source, /Пароли не совпадают/);
  assert.match(source, /placeholder="Повторите пароль"/);
});

test('signup shows email confirmation instructions whenever no session is returned', async () => {
  const source = await readFile('src/contexts/AuthContext.jsx', 'utf8');

  assert.match(source, /requiresEmailConfirmation:[\s\S]*!data\?\.access_token[\s\S]*!data\?\.refresh_token/);
});
