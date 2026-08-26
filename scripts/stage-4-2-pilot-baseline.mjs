import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

import { DEFAULT_APP_URL, runProductionSecuritySmoke } from './production-security-smoke.mjs';

const execFile = promisify(execFileCallback);

export const DEFAULT_REPOSITORY = 'zorgoalex/FinTrackApp';
export const MAX_MONITOR_GAP_MS = 12 * 60 * 60 * 1000;
export const BACKUP_SCHEDULE_GRACE_MS = 45 * 60 * 1000;

const WORKFLOWS = {
  quality: { name: 'Quality gates', limit: 5 },
  security: { name: 'Security checks', limit: 5 },
  monitor: { name: 'Production security monitor', limit: 15 },
  backup: { name: 'Encrypted production backup', limit: 10 },
};

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

async function run(command, args) {
  const { stdout } = await execFile(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.trim();
}

async function ghRunList(workflow) {
  const output = await run('gh', [
    'run',
    'list',
    '--workflow',
    workflow.name,
    '--branch',
    'main',
    '--limit',
    String(workflow.limit),
    '--json',
    'databaseId,headSha,status,conclusion,createdAt,updatedAt,url',
  ]);
  return parseJson(output, workflow.name);
}

function latestForSha(runs, sha) {
  return runs.find((run) => run.headSha === sha) || null;
}

export function evaluateMonitorRuns(runs, now = new Date()) {
  const completed = runs
    .filter((run) => run.status === 'completed')
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  invariant(completed.length > 0, 'no completed production monitor runs found');

  const latest = completed[0];
  const ageMs = now - new Date(latest.updatedAt);
  const recentFailures = completed.filter(
    (run) => now - new Date(run.updatedAt) <= MAX_MONITOR_GAP_MS && run.conclusion !== 'success',
  );

  return {
    ok: latest.conclusion === 'success' && ageMs <= MAX_MONITOR_GAP_MS && recentFailures.length === 0,
    latest,
    ageMs,
    recentFailures,
  };
}

export function nextBackupDeadline(deployedAt) {
  const deployed = new Date(deployedAt);
  const next = new Date(Date.UTC(
    deployed.getUTCFullYear(),
    deployed.getUTCMonth(),
    deployed.getUTCDate(),
    2,
    17,
  ));
  if (next <= deployed) next.setUTCDate(next.getUTCDate() + 1);
  return new Date(next.getTime() + BACKUP_SCHEDULE_GRACE_MS);
}

export function evaluateBackupCoverage(runs, deployedAt, now = new Date()) {
  const successful = runs
    .filter((run) => run.status === 'completed' && run.conclusion === 'success')
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  invariant(successful.length > 0, 'no successful encrypted backup runs found');

  const firstAfterDeploy = successful
    .filter((run) => new Date(run.createdAt) > new Date(deployedAt))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0] || null;
  const deadline = nextBackupDeadline(deployedAt);

  if (firstAfterDeploy) {
    return { status: 'pass', latest: successful[0], firstAfterDeploy, deadline };
  }
  return {
    status: now <= deadline ? 'pending' : 'fail',
    latest: successful[0],
    firstAfterDeploy: null,
    deadline,
  };
}

export function extractAssetPath(html) {
  return html.match(/\/assets\/index-[^"']+\.js/)?.[0] || null;
}

async function inspectProduction(appUrl, expectedSha, fetchImpl = fetch) {
  const home = await fetchImpl(`${appUrl}/`, { redirect: 'follow' });
  invariant(home.status === 200, `production home returned ${home.status}`);
  const html = await home.text();
  const assetPath = extractAssetPath(html);
  invariant(assetPath, 'production entry asset was not found');
  const asset = await fetchImpl(`${appUrl}${assetPath}`);
  invariant(asset.status === 200, `production asset returned ${asset.status}`);
  const assetText = await asset.text();
  invariant(assetText.includes(expectedSha.slice(0, 7)), 'production bundle does not contain expected build SHA');

  const headers = {
    csp: Boolean(home.headers.get('content-security-policy')),
    hsts: Boolean(home.headers.get('strict-transport-security')),
    nosniff: home.headers.get('x-content-type-options')?.toLowerCase() === 'nosniff',
    frameDeny: home.headers.get('x-frame-options')?.toUpperCase() === 'DENY',
  };
  invariant(Object.values(headers).every(Boolean), 'one or more production security headers are missing');

  return {
    status: home.status,
    assetPath,
    buildSha: expectedSha,
    headers,
  };
}

async function inspectDeployment(repository, sha) {
  const deployments = parseJson(
    await run('gh', ['api', `repos/${repository}/deployments?sha=${sha}&environment=Production&per_page=5`]),
    'GitHub deployments',
  );
  invariant(deployments.length > 0, `no Production deployment found for ${sha}`);
  const deployment = deployments[0];
  const statuses = parseJson(
    await run('gh', ['api', `repos/${repository}/deployments/${deployment.id}/statuses`]),
    'GitHub deployment statuses',
  );
  invariant(statuses[0]?.state === 'success', `Production deployment ${deployment.id} is not successful`);
  return {
    id: deployment.id,
    createdAt: deployment.created_at,
    status: statuses[0].state,
    environmentUrl: statuses[0].environment_url || null,
  };
}

export async function collectPilotBaseline({
  appUrl = DEFAULT_APP_URL,
  repository = DEFAULT_REPOSITORY,
  includeSmoke = false,
  now = new Date(),
} = {}) {
  const [status, head, origin, divergence, qualityRuns, securityRuns, monitorRuns, backupRuns] = await Promise.all([
    run('git', ['status', '--short', '--branch']),
    run('git', ['rev-parse', 'HEAD']),
    run('git', ['rev-parse', 'origin/main']),
    run('git', ['rev-list', '--left-right', '--count', 'HEAD...origin/main']),
    ghRunList(WORKFLOWS.quality),
    ghRunList(WORKFLOWS.security),
    ghRunList(WORKFLOWS.monitor),
    ghRunList(WORKFLOWS.backup),
  ]);

  const [ahead, behind] = divergence.split(/\s+/).map(Number);
  invariant(behind === 0, `local HEAD is ${behind} commit(s) behind origin/main`);
  invariant(status.split(/\r?\n/).every((line) => line.startsWith('##')), 'Git working tree is not clean');

  const quality = latestForSha(qualityRuns, origin);
  const security = latestForSha(securityRuns, origin);
  invariant(quality?.status === 'completed' && quality.conclusion === 'success', `latest Quality gates are not successful for ${origin}`);
  invariant(security?.status === 'completed' && security.conclusion === 'success', `latest Security checks are not successful for ${origin}`);

  const deployment = await inspectDeployment(repository, origin);
  const [production, smoke] = await Promise.all([
    inspectProduction(appUrl, origin),
    includeSmoke ? runProductionSecuritySmoke({ appUrl }) : Promise.resolve(null),
  ]);
  const monitor = evaluateMonitorRuns(monitorRuns, now);
  invariant(monitor.ok, 'production monitor is stale or has a recent failure');
  invariant(monitor.latest.headSha === origin, `latest production monitor targets ${monitor.latest.headSha}, expected ${origin}`);
  const backup = evaluateBackupCoverage(backupRuns, deployment.createdAt, now);
  invariant(backup.status !== 'fail', `no successful post-deploy backup by ${backup.deadline.toISOString()}`);

  return {
    checkedAt: now.toISOString(),
    verdict: backup.status === 'pass' ? 'READY_FOR_OWNER_DAY_0' : 'CONDITIONAL_BACKUP_PENDING',
    git: { localHead: head, productionSha: origin, ahead, behind, clean: true },
    quality,
    security,
    deployment,
    production,
    monitor: {
      latestRunId: monitor.latest.databaseId,
      latestUpdatedAt: monitor.latest.updatedAt,
      recentFailures: monitor.recentFailures.length,
    },
    backup: {
      status: backup.status,
      latestRunId: backup.latest.databaseId,
      latestCreatedAt: backup.latest.createdAt,
      firstAfterDeployRunId: backup.firstAfterDeploy?.databaseId || null,
      deadline: backup.deadline.toISOString(),
    },
    smoke,
    manualOwnerChecks: [
      'Confirm cohort size, admission policy, support owner and optional scope.',
      'Confirm deny-all database network allowlist in the Supabase control plane.',
      'Run only the aggregate Stage 4.2 security-event SQL in an owner-controlled SQL session.',
      'Complete Day 0 smoke with owner-controlled accounts and synthetic data.',
    ],
  };
}

function printHuman(result) {
  console.log(`Stage 4.2 pilot baseline: ${result.verdict}`);
  console.log(`Checked at: ${result.checkedAt}`);
  console.log(`Production/origin SHA: ${result.git.productionSha}`);
  console.log(`Local HEAD: ${result.git.localHead} (${result.git.ahead} ahead, ${result.git.behind} behind)`);
  console.log(`Quality: ${result.quality.databaseId}; Security: ${result.security.databaseId}`);
  console.log(`Deployment: ${result.deployment.id} (${result.deployment.status})`);
  console.log(`Monitor: ${result.monitor.latestRunId} (${result.monitor.latestUpdatedAt})`);
  console.log(`Backup: ${result.backup.status}; latest ${result.backup.latestRunId}; post-deploy ${result.backup.firstAfterDeployRunId || 'pending'}`);
  if (result.smoke) console.log(`Production smoke: ${result.smoke.checkedFunctions} functions PASS`);
  console.log('Owner-only checks remain:');
  for (const item of result.manualOwnerChecks) console.log(`- ${item}`);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const result = await collectPilotBaseline({ includeSmoke: args.has('--smoke') });
  if (args.has('--json')) console.log(JSON.stringify(result, null, 2));
  else printHuman(result);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Stage 4.2 pilot baseline failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exit(1);
  });
}
