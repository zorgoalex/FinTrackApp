import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorkspaceBackupDocument,
  validateWorkspaceBackupDocument,
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
  assert.equal(backup.version, 2);
  assert.equal(backup.workspace.base_currency, 'KZT');
  assert.deepEqual(backup.data.accounts, [{ id: 'account-1' }]);
  assert.deepEqual(backup.data.categories, []);
  assert.deepEqual(backup.data.budgets, [{ id: 'budget-1', amount: 50000 }]);
  assert.deepEqual(backup.data.importSessions, [{ id: 'import-1', document_hash: 'hash' }]);
  assert.deepEqual(backup.data.operationComments, [{ id: 'comment-1', operation_id: 'operation-1' }]);
  assert.equal('workspaceInvitations' in backup.data, false);
});

test('validates a current backup and returns a restore preview', () => {
  const backup = buildWorkspaceBackupDocument({
    workspace: { id: 'workspace-1', name: 'Компания', base_currency: 'KZT' },
    data: { accounts: [{ id: 'account-1' }], operations: [{ id: 'operation-1' }] },
  });
  const preview = validateWorkspaceBackupDocument(backup);
  assert.equal(preview.counts.accounts, 1);
  assert.equal(preview.counts.operations, 1);
  assert.equal(preview.totalRows, 2);
});

test('rejects legacy and malformed backups before any RPC call', () => {
  assert.throws(() => validateWorkspaceBackupDocument({ format: 'fintrack-workspace-backup', version: 1 }), /версии 2/);
  assert.throws(() => validateWorkspaceBackupDocument({ format: 'other', version: 2 }), /Неизвестный формат/);
});

test('creates a filesystem-safe backup filename', () => {
  const filename = workspaceBackupFilename(
    'Семья / Компания: 2026',
    new Date('2026-07-11T12:00:00.000Z')
  );

  assert.equal(filename, 'fintrack_backup_Семья_Компания_2026_2026-07-11.json');
});
