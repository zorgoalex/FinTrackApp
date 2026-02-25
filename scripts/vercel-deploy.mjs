/**
 * Deploy dist/ to Vercel via REST API.
 * Reads VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID from env.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { createHash } from 'crypto';

const TOKEN = process.env.VERCEL_TOKEN;
const TEAM_ID = process.env.VERCEL_TEAM_ID;
const PROJECT_NAME = process.env.VERCEL_PROJECT_NAME || 'fintrackapp';

if (!TOKEN) { console.error('VERCEL_TOKEN is required'); process.exit(1); }

const DIST_DIR = join(process.cwd(), 'dist');

function getAllFiles(dir, base = dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) results.push(...getAllFiles(full, base));
    else results.push({ full, rel: relative(base, full) });
  }
  return results;
}

async function uploadFile(content, sha) {
  const res = await fetch('https://api.vercel.com/v2/files', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/octet-stream',
      'x-vercel-digest': sha,
    },
    body: content,
  });
  if (res.status !== 200 && res.status !== 409) {
    throw new Error(`Upload failed ${res.status}: ${await res.text()}`);
  }
}

console.log('📦 Uploading dist/ files to Vercel...');
const files = getAllFiles(DIST_DIR);
const fileRefs = [];

for (const { full, rel } of files) {
  const content = readFileSync(full);
  const sha = createHash('sha1').update(content).digest('hex');
  await uploadFile(content, sha);
  fileRefs.push({ file: rel, sha, size: content.length });
  process.stdout.write('.');
}
console.log(`\n✅ Uploaded ${fileRefs.length} files`);

const teamParam = TEAM_ID ? `?teamId=${TEAM_ID}` : '';
const res = await fetch(`https://api.vercel.com/v13/deployments${teamParam}`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: PROJECT_NAME,
    files: fileRefs,
    target: 'production',
    projectSettings: {
      framework: null,
      buildCommand: '',
      outputDirectory: '',
      installCommand: '',
      devCommand: '',
    },
  }),
});

const data = await res.json();
if (data.error) {
  console.error('❌ Deploy error:', JSON.stringify(data.error));
  process.exit(1);
}

console.log('🚀 Deployment created:', data.id);
console.log('🔗 URL:', data.url);
console.log('📊 State:', data.readyState);

// Poll until ready
if (data.readyState !== 'READY') {
  console.log('⏳ Waiting for deployment...');
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 10000));
    const check = await fetch(`https://api.vercel.com/v13/deployments/${data.id}${teamParam}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    const status = await check.json();
    console.log(`   ${status.readyState}`);
    if (status.readyState === 'READY') { console.log('✅ Deployed!'); break; }
    if (status.readyState === 'ERROR') { console.error('❌ Deploy failed'); process.exit(1); }
  }
}
