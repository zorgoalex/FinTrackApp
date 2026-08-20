import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  checkPwnedPassword,
  findPwnedCount,
  PASSWORD_CHECK_UNAVAILABLE_MESSAGE,
  sha1Hex,
} from '../supabase/functions/_shared/passwordSecurity.js';

test('HIBP check sends only a five-character SHA-1 prefix with padded responses', async () => {
  const expectedHash = '5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8';
  assert.equal(await sha1Hex('password'), expectedHash);

  const result = await checkPwnedPassword('password', {
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.pwnedpasswords.com/range/5BAA6');
      assert.equal(options.headers['Add-Padding'], 'true');
      assert.doesNotMatch(url, /1E4C9B93F3F0682250B6CF8331B7EE68FD8/);
      return new globalThis.Response(`00000000000000000000000000000000000:0\r\n${expectedHash.slice(5)}:42000000\r\n`);
    },
  });

  assert.deepEqual(result, { pwned: true });
});

test('padded zero-count entries do not mark a password as breached', async () => {
  assert.equal(findPwnedCount('ABC:0\r\nDEF:12', 'ABC'), 0);
  const result = await checkPwnedPassword('UniquePasswordForUnitTest42', {
    fetchImpl: async () => new globalThis.Response('00000000000000000000000000000000000:0\r\n'),
  });
  assert.deepEqual(result, { pwned: false });
});

test('HIBP outages fail closed without exposing password material', async () => {
  await assert.rejects(
    checkPwnedPassword('UniquePasswordForUnitTest42', {
      fetchImpl: async () => new globalThis.Response('unavailable', { status: 503 }),
    }),
    (error) => error.code === 'PASSWORD_CHECK_UNAVAILABLE'
      && error.message === PASSWORD_CHECK_UNAVAILABLE_MESSAGE,
  );
});

test('signup and password update use the proof-gated Edge path', async () => {
  const auth = await readFile('src/contexts/AuthContext.jsx', 'utf8');
  const edge = await readFile('supabase/functions/password-auth/index.ts', 'utf8');
  const migration = await readFile('supabase/migrations/20260821010000_password_breach_protection.sql', 'utf8');
  const enforcement = await readFile('supabase/migrations/20260821020000_enforce_password_breach_protection.sql', 'utf8');
  const config = await readFile('supabase/config.toml', 'utf8');

  assert.match(auth, /functions\.invoke\('password-auth',[\s\S]*action: 'signup'/);
  assert.match(auth, /functions\.invoke\('password-auth',[\s\S]*action: 'update'/);
  assert.doesNotMatch(auth, /supabase\.auth\.signUp\(/);
  assert.doesNotMatch(auth, /updateUser\(\{\s*password/);
  assert.match(edge, /checkPwnedPassword\(password\)/);
  assert.match(edge, /password_policy_proofs/);
  assert.match(edge, /_password_policy_proof/);
  assert.match(edge, /current_password: currentPassword/);
  assert.match(edge, /\['otp', 'magiclink', 'recovery'\]/);
  assert.match(edge, /15 \* 60/);
  assert.match(enforcement, /BEFORE INSERT OR UPDATE OF encrypted_password ON auth\.users/);
  assert.match(migration, /Password rejected by security policy/);
  assert.match(config, /\[functions\.password-auth\]\s+verify_jwt = false/);
});
