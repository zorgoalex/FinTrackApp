import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import {
  buildReferenceKey,
  clearFinTrackCaches,
  enqueueOfflineExpense,
  isOfflineExpenseType,
  isOfflineStorageEnabled,
  isOwnedOfflineRecord,
  setOfflineStorageEnabled,
} from '../src/utils/offlineStore.js';

test('offline queue accepts outgoing expense types only', () => {
  assert.equal(isOfflineExpenseType('expense'), true);
  assert.equal(isOfflineExpenseType('employee_salary'), true);
  assert.equal(isOfflineExpenseType('income'), false);
  assert.equal(isOfflineExpenseType('transfer'), false);
});

test('offline records and reference keys are isolated by authenticated user', () => {
  assert.equal(buildReferenceKey('user-a', 'accounts', 'workspace-1'), 'user-a:accounts:workspace-1');
  assert.equal(buildReferenceKey('user-b', 'accounts', 'workspace-1'), 'user-b:accounts:workspace-1');
  assert.equal(buildReferenceKey(null, 'accounts', 'workspace-1'), null);
  assert.equal(isOwnedOfflineRecord({ user_id: 'user-a' }, 'user-a'), true);
  assert.equal(isOwnedOfflineRecord({ user_id: 'user-a' }, 'user-b'), false);
  assert.equal(isOwnedOfflineRecord({ workspace_id: 'workspace-1' }, 'user-a'), false);
});

test('offline expense cannot be queued without an authenticated owner', async () => {
  await assert.rejects(
    enqueueOfflineExpense({ workspaceId: 'workspace-1', payload: { p_type: 'expense' } }),
    /определить пользователя/,
  );
});

test('device owner can disable and re-enable offline financial storage', async () => {
  const originalLocalStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  try {
    assert.equal(isOfflineStorageEnabled(), true);
    await setOfflineStorageEnabled(false, 'user-a');
    assert.equal(isOfflineStorageEnabled(), false);
    await assert.rejects(
      enqueueOfflineExpense({ userId: 'user-a', workspaceId: 'workspace-1', payload: { p_type: 'expense' } }),
      /Офлайн-хранение отключено/,
    );
    await setOfflineStorageEnabled(true, 'user-a');
    assert.equal(isOfflineStorageEnabled(), true);
  } finally {
    if (originalLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalLocalStorage;
  }
});

test('logout cache cleanup removes FinTrack caches only', async () => {
  const originalCaches = globalThis.caches;
  const deleted = [];
  globalThis.caches = {
    keys: async () => ['fintrack-shell-v1', 'fintrack-sensitive-v2', 'unrelated-cache'],
    delete: async (name) => { deleted.push(name); return true; },
  };
  try {
    await clearFinTrackCaches();
    assert.deepEqual(deleted.sort(), ['fintrack-sensitive-v2', 'fintrack-shell-v1']);
  } finally {
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});

test('PWA manifest is installable and exposes the expense shortcut', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.scope, '/');
  assert.ok(manifest.icons.some((icon) => icon.purpose.includes('maskable')));
  assert.ok(manifest.shortcuts.some((shortcut) => shortcut.url.includes('new=expense')));
});

test('service worker handles offline navigation and Web Push', async () => {
  const worker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(worker, /request\.mode === 'navigate'/);
  assert.match(worker, /caches\.match\('\/index\.html'\)/);
  assert.match(worker, /addEventListener\('push'/);
  assert.match(worker, /showNotification/);
  assert.match(worker, /addEventListener\('notificationclick'/);
});
