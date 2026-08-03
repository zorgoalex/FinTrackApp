import assert from 'node:assert/strict';
import test from 'node:test';

import { toDatabaseWorkspaceRole } from '../src/utils/workspaceRole.js';

test('normalizes UI workspace roles to the database enum labels', () => {
  assert.equal(toDatabaseWorkspaceRole('admin'), 'Admin');
  assert.equal(toDatabaseWorkspaceRole('member'), 'Member');
  assert.equal(toDatabaseWorkspaceRole('viewer'), 'Viewer');
  assert.equal(toDatabaseWorkspaceRole(' Viewer '), 'Viewer');
});

test('rejects unknown or non-string workspace roles', () => {
  assert.equal(toDatabaseWorkspaceRole('editor'), null);
  assert.equal(toDatabaseWorkspaceRole(null), null);
});
