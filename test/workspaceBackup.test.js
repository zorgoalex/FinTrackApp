import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorkspaceBackupDocument,
  workspaceBackupFilename
} from '../src/utils/workspaceBackup.js';

test('builds a versioned workspace backup without invitation secrets', () => {
  const backup = buildWorkspaceBackupDocument({
    workspace: { id: 'workspace-1', name: 'Семейный бюджет', base_currency: 'KZT' },
    exportedAt: '2026-07-11T12:00:00.000Z',
    data: {
      accounts: [{ id: 'account-1' }],
      operations: [{ id: 'operation-1' }],
      operationTags: [{ operation_id: 'operation-1', tag_id: 'tag-1' }],
      budgets: [{ id: 'budget-1', amount: 50000 }],
      importSessions: [{ id: 'import-1', document_hash: 'hash' }],
      operationComments: [{ id: 'comment-1', operation_id: 'operation-1' }]
    }
  });

  assert.equal(backup.format, 'fintrack-workspace-backup');
  assert.equal(backup.version, 1);
  assert.equal(backup.workspace.base_currency, 'KZT');
  assert.deepEqual(backup.data.accounts, [{ id: 'account-1' }]);
  assert.deepEqual(backup.data.categories, []);
  assert.deepEqual(backup.data.budgets, [{ id: 'budget-1', amount: 50000 }]);
  assert.deepEqual(backup.data.importSessions, [{ id: 'import-1', document_hash: 'hash' }]);
  assert.deepEqual(backup.data.operationComments, [{ id: 'comment-1', operation_id: 'operation-1' }]);
  assert.equal('workspaceInvitations' in backup.data, false);
});

test('creates a filesystem-safe backup filename', () => {
  const filename = workspaceBackupFilename(
    'Семья / Компания: 2026',
    new Date('2026-07-11T12:00:00.000Z')
  );

  assert.equal(filename, 'fintrack_backup_Семья_Компания_2026_2026-07-11.json');
});
