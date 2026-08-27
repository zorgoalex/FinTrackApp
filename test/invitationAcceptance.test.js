import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('invitation acceptance reads safe Edge error details for the user', async () => {
  const source = await readFile('src/pages/InvitationAcceptPage.jsx', 'utf8');

  assert.match(source, /error\?\.context\?\.json\(\)/);
  assert.match(source, /invitationErrorMessage\(functionError, data\)/);
});

test('accepted invitation is idempotent only for its existing recipient membership', async () => {
  const source = await readFile('supabase/functions/accept-invitation/index.ts', 'utf8');

  assert.match(source, /invitation\.status === 'accepted'/);
  assert.match(source, /workspace_members/);
  assert.match(source, /alreadyAccepted: true/);
  assert.match(source, /invitedEmail !== acceptingEmail[\s\S]*invitation\.status === 'accepted'/);
});
