import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import {
  clearLocalFinancialData,
  clearLocalPrivacyData,
  clearFinTrackCaches,
  enqueueOfflineExpense,
  isOfflineStorageEnabled,
  setOfflineStorageEnabled,
} from '../src/utils/offlineStore.js';
import { INTERNET_REQUIRED_MESSAGE, isInternetAvailable } from '../src/utils/connectivity.js';

test('internet availability treats an explicitly offline browser as disconnected', () => {
  assert.equal(isInternetAvailable({ onLine: true }), true);
  assert.equal(isInternetAvailable({ onLine: false }), false);
  assert.match(INTERNET_REQUIRED_MESSAGE, /подключение к интернету/);
});

test('login and cached session restoration are blocked while offline', async () => {
  const [loginPage, authContext] = await Promise.all([
    readFile(new URL('../src/pages/LoginPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/contexts/AuthContext.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(loginPage, /disabled=\{loading \|\| !online\}/);
  assert.match(loginPage, /Нет соединения/);
  assert.match(authContext, /window\.addEventListener\('offline', handleOffline\)/);
  assert.match(authContext, /if \(!isInternetAvailable\(\)\)/);
  assert.match(authContext, /await supabase\.auth\.getUser\(\)/);
  assert.match(authContext, /event === 'INITIAL_SESSION'/);
});

test('offline financial queue is disabled even for an authenticated owner', async () => {
  assert.equal(isOfflineStorageEnabled(), false);
  await assert.rejects(
    enqueueOfflineExpense({ userId: 'user-a', workspaceId: 'workspace-1', payload: { p_type: 'expense' } }),
    /подключение к интернету/,
  );
});

test('offline financial storage cannot be re-enabled in beta', async () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalIndexedDB = globalThis.indexedDB;
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  globalThis.indexedDB = {
    deleteDatabase: () => {
      const request = {};
      Promise.resolve().then(() => request.onsuccess?.());
      return request;
    },
  };
  try {
    await setOfflineStorageEnabled(true, 'user-a');
    assert.equal(isOfflineStorageEnabled(), false);
    assert.equal(values.get('fintrack:offline-storage-enabled'), 'false');
  } finally {
    if (originalLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalLocalStorage;
    if (originalIndexedDB === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = originalIndexedDB;
  }
});

test('startup cleanup deletes the legacy offline database', async () => {
  const originalIndexedDB = globalThis.indexedDB;
  const deleted = [];
  globalThis.indexedDB = {
    deleteDatabase: (name) => {
      deleted.push(name);
      const request = {};
      Promise.resolve().then(() => request.onsuccess?.());
      return request;
    },
  };
  try {
    await clearLocalFinancialData();
    assert.deepEqual(deleted, ['fintrack-offline']);
  } finally {
    if (originalIndexedDB === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = originalIndexedDB;
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

test('logout removes account and workspace identifiers but preserves generic preferences', () => {
  const originalLocalStorage = globalThis.localStorage;
  const values = new Map([
    ['user', '{"id":"user-a","email":"private@example.test"}'],
    ['lastWorkspaceId', 'workspace-a'],
    ['dashboardBlocks_workspace-a', '{"accounts":true}'],
    ['visibleAccounts_workspace-a', '["account-a"]'],
    ['accountsSummaryOnly_workspace-a', 'true'],
    ['theme', 'dark'],
    ['operationsViewMode', 'table'],
  ]);
  globalThis.localStorage = {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  try {
    clearLocalPrivacyData();
    for (const key of [
      'user',
      'lastWorkspaceId',
      'dashboardBlocks_workspace-a',
      'visibleAccounts_workspace-a',
      'accountsSummaryOnly_workspace-a',
    ]) assert.equal(values.has(key), false, `${key} should be removed`);
    assert.equal(values.get('theme'), 'dark');
    assert.equal(values.get('operationsViewMode'), 'table');
  } finally {
    if (originalLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalLocalStorage;
  }
});

test('PWA manifest is installable and exposes the expense shortcut', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.scope, '/');
  assert.ok(manifest.icons.some((icon) => icon.purpose.includes('maskable')));
  assert.ok(manifest.shortcuts.some((shortcut) => shortcut.url.includes('new=expense')));
});

test('service worker keeps install navigation and Web Push support', async () => {
  const [worker, main, app, boundary] = await Promise.all([
    readFile(new URL('../public/sw.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/AppErrorBoundary.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(worker, /request\.mode === 'navigate'/);
  assert.doesNotMatch(worker, /caches\.match\('\/index\.html'\)/);
  assert.match(worker, /event\.respondWith\(globalThis\.fetch\(request\)\)/);
  assert.match(worker, /fintrack-static-v3/);
  assert.match(worker, /STATIC_PATHS\.has\(url\.pathname\)/);
  assert.doesNotMatch(worker, /return cached \|\| network/);
  assert.match(main, /updateViaCache: 'none'/);
  assert.match(app, /errorElement: <RouteErrorBoundary \/>/);
  assert.match(boundary, /recoverFromStaleChunk/);
  assert.match(boundary, /Failed to fetch dynamically imported module/);
  assert.match(boundary, /key\.startsWith\('fintrack-'\)/);
  assert.match(worker, /addEventListener\('push'/);
  assert.match(worker, /showNotification/);
  assert.match(worker, /addEventListener\('notificationclick'/);
});
