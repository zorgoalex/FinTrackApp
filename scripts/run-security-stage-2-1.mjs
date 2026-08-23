import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLocalHttpAudit } from './security-stage-2-1-http.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const SQL_RUNNER = join(SCRIPT_DIR, 'security-stage-2-1-rls.sql');

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, options = {}) {
  const useCmdWrapper = process.platform === 'win32' && command === 'npx';
  const executable = useCmdWrapper ? (process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe') : command;
  const finalArgs = useCmdWrapper ? ['/d', '/s', '/c', 'npx', ...args] : args;
  const result = spawnSync(executable, finalArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error,
  };
}

export function parseSupabaseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

function localSupabaseEnv() {
  let status = run('npx', ['supabase', 'status', '-o', 'env']);
  if (status.status !== 0) {
    const start = run('npx', ['supabase', 'start']);
    invariant(start.status === 0, `local Supabase could not start: ${start.stderr.trim().split(/\r?\n/).at(-1) || 'unknown error'}`);
    status = run('npx', ['supabase', 'status', '-o', 'env']);
  }
  invariant(status.status === 0, 'local Supabase status is unavailable');
  const values = parseSupabaseEnv(status.stdout);
  for (const name of ['API_URL', 'DB_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY']) {
    invariant(values[name], `local Supabase did not provide ${name}`);
  }
  return values;
}

function migrateLocalDatabase() {
  const result = run('npx', ['supabase', 'migration', 'up', '--local']);
  invariant(result.status === 0, `local migrations failed: ${result.stderr.trim().split(/\r?\n/).at(-1) || 'unknown error'}`);
}

export function summarizeSqlOutput(result) {
  const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
  const planned = Number(combined.match(/1\.\.(\d+)/)?.[1] || 0);
  const ok = (combined.match(/^ok\s+\d+/gm) || []).length;
  const notOk = (combined.match(/^not ok\s+\d+/gm) || []).length;
  const failed = result.status !== 0 || notOk > 0 || /# Failed test/i.test(combined) || planned === 0 || ok !== planned;
  return {
    passed: !failed,
    planned,
    ok,
    notOk,
    exitCode: result.status,
    failure: failed
      ? combined.split(/\r?\n/).filter((line) => /not ok|failed test|error:/i.test(line)).slice(0, 12)
      : [],
  };
}

function runSqlAudit(databaseUrl) {
  const result = run(process.env.PSQL || 'psql', ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', SQL_RUNNER, databaseUrl]);
  return summarizeSqlOutput(result);
}

function reportPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const directory = join(ROOT, 'artifacts', 'security-stage-2-1', stamp);
  mkdirSync(directory, { recursive: true });
  return join(directory, 'report.json');
}

async function main() {
  const targetIndex = process.argv.indexOf('--target');
  const target = targetIndex >= 0 ? process.argv[targetIndex + 1] : 'local';
  invariant(target === 'local', 'orchestrator is intentionally local-only; use security:test:stage-2-1:http for production read-only mode');

  const startedAt = new Date().toISOString();
  const local = localSupabaseEnv();
  migrateLocalDatabase();
  const sql = runSqlAudit(local.DB_URL);
  const http = await runLocalHttpAudit({ apiUrl: local.API_URL, anonKey: local.ANON_KEY, serviceRoleKey: local.SERVICE_ROLE_KEY });
  const passed = sql.passed && http.summary.failed === 0 && http.cleanup.passed;
  const report = {
    schemaVersion: 1,
    stage: '2.1',
    target: 'local',
    startedAt,
    finishedAt: new Date().toISOString(),
    passed,
    sql,
    http,
    guarantees: {
      productionTouched: false,
      secretsIncluded: false,
      fixtureCleanupVerified: Boolean(http.cleanup.passed),
      maxHttpRequests: 48,
    },
  };
  const destination = reportPath();
  writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log(`Stage 2.1 local audit: ${passed ? 'PASS' : 'FAIL'}`);
  console.log(`SQL: ${sql.ok}/${sql.planned}; HTTP: ${http.summary.passed}/${http.summary.checks}; requests: ${http.summary.requests}`);
  console.log(`Sanitized report: ${destination.slice(ROOT.length + 1)}`);
  if (!passed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Stage 2.1 runner stopped: ${error.message}`);
    process.exitCode = 1;
  });
}
