import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const startedAt = new Date();
const root = process.cwd();
const sourceRoots = ['src', 'supabase/functions'];
const forbiddenSinks = [
  { name: 'dangerouslySetInnerHTML', pattern: /dangerouslySetInnerHTML/u },
  { name: 'innerHTML assignment', pattern: /\.innerHTML\s*=/u },
  { name: 'eval', pattern: /\beval\s*\(/u },
  { name: 'Function constructor', pattern: /\bnew\s+Function\s*\(/u },
  { name: 'document.write', pattern: /\bdocument\.write\s*\(/u },
  { name: 'srcDoc', pattern: /\bsrcDoc\s*=/u },
];

async function listSourceFiles(directory) {
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listSourceFiles(fullPath));
    else if (/\.(?:js|jsx|ts|tsx)$/u.test(entry.name)) files.push(fullPath);
  }
  return files;
}

const findings = [];
for (const sourceRoot of sourceRoots) {
  for (const file of await listSourceFiles(path.join(root, sourceRoot))) {
    const source = await readFile(file, 'utf8');
    for (const sink of forbiddenSinks) {
      if (sink.pattern.test(source)) findings.push({ sink: sink.name, file: path.relative(root, file).replaceAll('\\', '/') });
    }
  }
}

const testRun = spawnSync(process.execPath, ['--test', 'test/securityStage22.test.js'], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
  env: { ...process.env, NODE_ENV: 'test' },
});
process.stdout.write(testRun.stdout || '');
process.stderr.write(testRun.stderr || '');

const combinedOutput = `${testRun.stdout || ''}\n${testRun.stderr || ''}`;
const passCount = Number(combinedOutput.match(/^# pass (\d+)$/mu)?.[1] || 0);
const failCount = Number(combinedOutput.match(/^# fail (\d+)$/mu)?.[1] || (testRun.status === 0 ? 0 : 1));
const succeeded = testRun.status === 0 && findings.length === 0;
const finishedAt = new Date();
const report = {
  schema: 1,
  stage: '2.2',
  scope: 'local-only',
  networkRequests: 0,
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  succeeded,
  tests: { pass: passCount, fail: failCount, exitCode: testRun.status ?? 1 },
  forbiddenSinkFindings: findings,
};
const stamp = finishedAt.toISOString().replace(/[:.]/gu, '-');
const artifactDir = path.join(root, 'artifacts', 'security-stage-2-2', stamp);
await mkdir(artifactDir, { recursive: true });
await writeFile(path.join(artifactDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

if (findings.length) {
  console.error(`Stage 2.2: обнаружены опасные DOM/JS sinks: ${findings.length}`);
  for (const finding of findings) console.error(`- ${finding.sink}: ${finding.file}`);
}
console.log(`Stage 2.2 report: ${path.relative(root, path.join(artifactDir, 'report.json'))}`);
if (!succeeded) process.exit(1);
