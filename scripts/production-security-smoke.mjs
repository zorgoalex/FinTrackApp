import { pathToFileURL } from 'node:url';

export const DEFAULT_APP_URL = 'https://fintrackapp.vip';
export const DEFAULT_FUNCTIONS_URL = 'https://trpfmcggvixnfmcgvxsq.supabase.co/functions/v1';
export const BROWSER_FUNCTIONS = [
  'accept-invitation',
  'ai-assistant',
  'api',
  'fetch-rates',
  'invite-user',
  'login-user',
  'password-auth',
  'security-event',
  'send-test-push',
  'stt-transcribe',
  'telegram-link',
];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function header(response, name) {
  return response.headers.get(name) || '';
}

export async function runProductionSecuritySmoke({
  fetchImpl = fetch,
  appUrl = DEFAULT_APP_URL,
  functionsUrl = DEFAULT_FUNCTIONS_URL,
} = {}) {
  const home = await fetchImpl(`${appUrl}/`, { redirect: 'follow' });
  invariant(home.status === 200, `home returned ${home.status}`);
  const csp = header(home, 'content-security-policy');
  invariant(csp.includes("default-src 'self'"), 'CSP default-src is missing');
  invariant(csp.includes('https://trpfmcggvixnfmcgvxsq.supabase.co'), 'CSP Supabase origin is missing');
  invariant(!/connect-src[^;]*(?:\shttps:|\swss:)(?:\s|;)/.test(csp), 'CSP connect-src is broad');
  invariant(header(home, 'strict-transport-security').includes('max-age=31536000'), 'HSTS is missing');
  invariant(header(home, 'x-content-type-options').toLowerCase() === 'nosniff', 'nosniff is missing');
  invariant(header(home, 'x-frame-options').toUpperCase() === 'DENY', 'frame protection is missing');

  const security = await fetchImpl(`${appUrl}/.well-known/security.txt`);
  invariant(security.status === 200, `security.txt returned ${security.status}`);
  const securityText = await security.text();
  invariant(securityText.includes('Contact: mailto:support@fintrackapp.vip'), 'security.txt contact is missing');
  invariant(securityText.includes(`Canonical: ${appUrl}/.well-known/security.txt`), 'security.txt canonical is invalid');

  for (const path of ['/.env', '/.git/config', '/src/main.jsx', '/package.json', '/app.js.map']) {
    const response = await fetchImpl(`${appUrl}${path}`, { redirect: 'manual' });
    invariant(response.status === 404, `${path} returned ${response.status}`);
    invariant(header(response, 'cache-control').includes('no-store'), `${path} is cacheable`);
  }

  for (const functionName of BROWSER_FUNCTIONS) {
    const endpoint = `${functionsUrl}/${functionName}`;
    const allowed = await fetchImpl(endpoint, {
      method: 'OPTIONS',
      headers: { Origin: appUrl, 'Access-Control-Request-Method': 'POST' },
    });
    invariant(allowed.status === 204, `${functionName} allowed preflight returned ${allowed.status}`);
    invariant(header(allowed, 'access-control-allow-origin') === appUrl, `${functionName} allowed origin mismatch`);

    const hostile = await fetchImpl(endpoint, {
      method: 'OPTIONS',
      headers: { Origin: 'https://attacker.example', 'Access-Control-Request-Method': 'POST' },
    });
    invariant(hostile.status === 403, `${functionName} hostile preflight returned ${hostile.status}`);
    invariant(!header(hostile, 'access-control-allow-origin'), `${functionName} exposed hostile origin`);
  }

  return { checkedFunctions: BROWSER_FUNCTIONS.length, checkedAt: new Date().toISOString() };
}

async function main() {
  const result = await runProductionSecuritySmoke({
    appUrl: process.env.PRODUCTION_APP_URL || DEFAULT_APP_URL,
    functionsUrl: process.env.PRODUCTION_FUNCTIONS_URL || DEFAULT_FUNCTIONS_URL,
  });
  console.log(`Production security smoke passed for ${result.checkedFunctions} Edge Functions at ${result.checkedAt}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Production security smoke failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exit(1);
  });
}
