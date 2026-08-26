import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  BACKUP_SCHEDULE_GRACE_MS,
  evaluateBackupCoverage,
  evaluateMonitorRuns,
  extractAssetPath,
  nextBackupDeadline,
} from './scripts/stage-4-2-pilot-baseline.mjs';

function run(overrides = {}) {
  return {
    databaseId: 1,
    headSha: 'abc',
    status: 'completed',
    conclusion: 'success',
    createdAt: '2026-08-26T03:00:00Z',
    updatedAt: '2026-08-26T03:02:00Z',
    ...overrides,
  };
}

test('extractAssetPath accepts only the production entry asset pattern', () => {
  assert.equal(extractAssetPath('<script src="/assets/index-AbC123.js"></script>'), '/assets/index-AbC123.js');
  assert.equal(extractAssetPath('<script src="/assets/vendor.js"></script>'), null);
});

test('monitor evidence is healthy only while the latest successful run is fresh', () => {
  const now = new Date('2026-08-26T14:00:00Z');
  assert.equal(evaluateMonitorRuns([run({ updatedAt: '2026-08-26T13:00:00Z' })], now).ok, true);
  assert.equal(evaluateMonitorRuns([run({ updatedAt: '2026-08-26T01:00:00Z' })], now).ok, false);
  assert.equal(
    evaluateMonitorRuns([run({ conclusion: 'failure', updatedAt: '2026-08-26T13:00:00Z' })], now).ok,
    false,
  );
});

test('backup stays pending until the first scheduled post-deploy run deadline', () => {
  const deployedAt = '2026-08-26T03:47:56Z';
  const deadline = nextBackupDeadline(deployedAt);
  assert.equal(deadline.toISOString(), new Date(Date.UTC(2026, 7, 26, 22, 0) + BACKUP_SCHEDULE_GRACE_MS).toISOString());
  assert.equal(
    evaluateBackupCoverage([run()], deployedAt, new Date('2026-08-26T14:00:00Z')).status,
    'pending',
  );
  assert.equal(
    evaluateBackupCoverage([run()], deployedAt, new Date('2026-08-26T23:30:00Z')).status,
    'fail',
  );
});

test('a successful backup after deployment closes the backup gate', () => {
  const result = evaluateBackupCoverage(
    [run({ databaseId: 2, createdAt: '2026-08-26T22:00:00Z', updatedAt: '2026-08-26T22:03:00Z' })],
    '2026-08-26T03:47:56Z',
    new Date('2026-08-26T22:30:00Z'),
  );
  assert.equal(result.status, 'pass');
  assert.equal(result.firstAfterDeploy.databaseId, 2);
});

test('encrypted backup is scheduled for 03:00 Asia/Qyzylorda', async () => {
  const workflow = await readFile('.github/workflows/encrypted-backup.yml', 'utf8');
  assert.match(workflow, /Asia\/Qyzylorda is UTC\+5 year-round/);
  assert.match(workflow, /cron: '0 22 \* \* \*'/);
  assert.doesNotMatch(workflow, /cron: '17 2 \* \* \*'/);
});
