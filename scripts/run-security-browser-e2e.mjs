import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSupabaseEnv } from './run-security-stage-2-1.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function run(command, args, options = {}) {
  const useCmd = process.platform === 'win32' && command === 'npx';
  const executable = useCmd ? (process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe') : command;
  const finalArgs = useCmd ? ['/d', '/s', '/c', 'npx', ...args] : args;
  return spawnSync(executable, finalArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
}

export function validateLoopbackUrl(value, name = 'URL') {
  const url = new URL(value);
  invariant(url.protocol === 'http:', `${name} must use http`);
  invariant(['127.0.0.1', 'localhost'].includes(url.hostname), `${name} must use a loopback host`);
  return url.origin;
}

export function parseBrowserArgs(args) {
  const result = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (['--list', '--headed'].includes(arg)) {
      result.push(arg);
      continue;
    }
    if (arg === '--grep') {
      const value = args[index + 1];
      invariant(['@sequential', '@concurrent'].includes(value), '--grep only accepts @sequential or @concurrent');
      result.push(arg, value);
      index += 1;
      continue;
    }
    throw new Error(`unsupported browser security argument: ${arg}`);
  }
  return result;
}

function localSupabase() {
  let startedHere = false;
  let status = run('npx', ['supabase', 'status', '-o', 'env']);
  if (status.status !== 0) {
    const start = run('npx', ['supabase', 'start']);
    invariant(start.status === 0, `local Supabase could not start: ${start.stderr.trim().split(/\r?\n/).at(-1) || 'unknown error'}`);
    startedHere = true;
    status = run('npx', ['supabase', 'status', '-o', 'env']);
  }
  invariant(status.status === 0, 'local Supabase status is unavailable');
  const values = parseSupabaseEnv(status.stdout || '');
  for (const name of ['API_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY']) {
    invariant(values[name], `local Supabase did not provide ${name}`);
  }
  validateLoopbackUrl(values.API_URL, 'Supabase API URL');
  return { values, startedHere };
}

function migrateLocal() {
  const result = run('npx', ['supabase', 'migration', 'up', '--local']);
  invariant(result.status === 0, `local migrations failed: ${result.stderr.trim().split(/\r?\n/).at(-1) || 'unknown error'}`);
}

export function buildBrowserEnvironment(local) {
  return {
    ...process.env,
    E2E_LOCAL_ONLY: '1',
    E2E_APP_URL: validateLoopbackUrl(process.env.E2E_APP_URL || 'http://127.0.0.1:4173', 'application URL'),
    E2E_SUPABASE_URL: validateLoopbackUrl(local.API_URL, 'Supabase API URL'),
    E2E_ANON_KEY: local.ANON_KEY,
    E2E_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
  };
}

export function main(args = process.argv.slice(2)) {
  const playwrightArgs = parseBrowserArgs(args);
  if (playwrightArgs.includes('--list')) {
    const listed = run('npx', ['playwright', 'test', ...playwrightArgs], {
      stdio: 'inherit',
      env: {
        ...process.env,
        E2E_LOCAL_ONLY: '1',
        E2E_APP_URL: 'http://127.0.0.1:4173',
        E2E_SUPABASE_URL: 'http://127.0.0.1:54321',
        E2E_ANON_KEY: 'list-only',
        E2E_SERVICE_ROLE_KEY: 'list-only',
      },
    });
    return listed.status ?? 1;
  }

  let local;
  try {
    local = localSupabase();
    migrateLocal();
    console.log('Browser security target: local Supabase + synthetic fixtures only');
    const result = run('npx', ['playwright', 'test', ...playwrightArgs], {
      stdio: 'inherit',
      env: buildBrowserEnvironment(local.values),
    });
    return result.status ?? 1;
  } finally {
    if (local?.startedHere) {
      const stopped = run('npx', ['supabase', 'stop']);
      if (stopped.status !== 0) console.error('Warning: local Supabase was not stopped cleanly');
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`Browser security runner stopped: ${error.message}`);
    process.exitCode = 1;
  }
}
