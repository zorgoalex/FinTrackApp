import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('test push endpoint targets only the authenticated user in the selected workspace', async () => {
  const source = await readFile('supabase/functions/send-test-push/index.ts', 'utf8');
  assert.match(source, /admin\.auth\.getUser/);
  assert.match(source, /\.eq\('workspace_id', workspaceId\)/);
  assert.match(source, /\.eq\('user_id', userData\.user\.id\)/);
  assert.match(source, /webpush\.sendNotification/);
  assert.match(source, /statusCode === 404 \|\| statusCode === 410/);
});

test('notification settings expose an isolated Web Push test action', async () => {
  const hook = await readFile('src/hooks/useNotifications.js', 'utf8');
  const component = await readFile('src/components/NotificationCenter.jsx', 'utf8');
  assert.match(hook, /functions\.invoke\('send-test-push'/);
  assert.match(component, /Отправить тестовое уведомление/);
  assert.match(component, /notifications\.sendTestBrowser\(\)/);
});
