import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  formatIdleCountdown,
  getIdleSessionState,
  IDLE_TIMEOUT_MS,
  IDLE_WARNING_MS,
} from '../src/utils/idleSession.js';

test('idle session warns for two minutes and expires after thirty minutes', () => {
  const startedAt = 1_000_000;
  const beforeWarning = getIdleSessionState(startedAt, startedAt + IDLE_TIMEOUT_MS - IDLE_WARNING_MS - 1);
  const warning = getIdleSessionState(startedAt, startedAt + IDLE_TIMEOUT_MS - IDLE_WARNING_MS);
  const expired = getIdleSessionState(startedAt, startedAt + IDLE_TIMEOUT_MS);

  assert.equal(beforeWarning.warning, false);
  assert.equal(beforeWarning.expired, false);
  assert.deepEqual(warning, {
    expired: false,
    warning: true,
    remainingMs: IDLE_WARNING_MS,
    remainingSeconds: 120,
  });
  assert.equal(expired.warning, false);
  assert.equal(expired.expired, true);
  assert.equal(expired.remainingSeconds, 0);
  assert.equal(formatIdleCountdown(120), '2:00');
  assert.equal(formatIdleCountdown(9.1), '0:10');
});

test('idle session implementation synchronizes tabs and fails closed on logout', async () => {
  const guard = await readFile('src/components/IdleSessionGuard.jsx', 'utf8');
  const auth = await readFile('src/contexts/AuthContext.jsx', 'utf8');
  const login = await readFile('src/pages/LoginPage.jsx', 'utf8');
  const config = await readFile('supabase/config.toml', 'utf8');

  assert.match(guard, /window\.addEventListener\('storage', handleStorage\)/);
  assert.match(guard, /event\.key === IDLE_EXPIRED_STORAGE_KEY/);
  assert.match(guard, /visibilitychange/);
  assert.match(guard, /pointerdown.*keydown.*touchstart/);
  assert.match(guard, /Сессия скоро завершится/);
  assert.match(auth, /signOut\(\{ scope: 'local' \}\)/);
  assert.match(auth, /IDLE_EXPIRED_STORAGE_KEY/);
  assert.match(auth, /clearLocalFinancialData\(userId\)/);
  assert.match(auth, /window\.location\.replace\('\/login\?reason=idle'\)/);
  assert.match(login, /Сессия завершена после 30 минут бездействия/);
  assert.match(config, /jwt_expiry = 1800/);
});
