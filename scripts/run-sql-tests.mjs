import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export function inspectTapOutput(output) {
  const failedAssertions = output
    .split(/\r?\n/)
    .filter((line) => /^not ok\b/i.test(line.trim()));
  const failedSummary = /#\s*Failed test\b/i.test(output);

  return {
    failed: failedAssertions.length > 0 || failedSummary,
    failedAssertions,
  };
}

function main() {
  const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL or SUPABASE_DB_URL is required to run SQL tests.');
    process.exit(2);
  }

  const psql = process.env.PSQL_BIN || 'psql';
  const testsDir = resolve('supabase', 'tests');
  const tests = readdirSync(testsDir)
    .filter((name) => name.endsWith('_test.sql'))
    .sort();

  if (tests.length === 0) {
    console.error('No SQL test files were found.');
    process.exit(2);
  }

  let failed = false;

  for (const test of tests) {
    console.log(`\n=== ${test} ===`);
    const result = spawnSync(psql, [
      '--no-psqlrc',
      '--set=ON_ERROR_STOP=1',
      '--dbname', databaseUrl,
      '--file', resolve(testsDir, test),
    ], {
      encoding: 'utf8',
      env: process.env,
      windowsHide: true,
    });

    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    process.stdout.write(stdout);
    process.stderr.write(stderr);

    if (result.error) {
      console.error(`Could not start psql: ${result.error.message}`);
      failed = true;
      break;
    }

    const tap = inspectTapOutput(`${stdout}\n${stderr}`);
    if (result.status !== 0 || tap.failed) {
      if (tap.failedAssertions.length > 0) {
        console.error(`TAP failures: ${tap.failedAssertions.join(' | ')}`);
      }
      failed = true;
    }
  }

  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main();
}
