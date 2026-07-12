import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import { isOfflineExpenseType } from '../src/utils/offlineStore.js';

test('offline queue accepts outgoing expense types only', () => {
  assert.equal(isOfflineExpenseType('expense'), true);
  assert.equal(isOfflineExpenseType('employee_salary'), true);
  assert.equal(isOfflineExpenseType('income'), false);
  assert.equal(isOfflineExpenseType('transfer'), false);
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
