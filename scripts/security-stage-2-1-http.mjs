import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { pathToFileURL, URL } from 'node:url';

export const PRODUCTION_PROJECT_REF = 'trpfmcggvixnfmcgvxsq';
export const PRODUCTION_API_ORIGIN = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;
export const PRODUCTION_CONFIRMATION = `${PRODUCTION_PROJECT_REF}:Security E2E:READ_ONLY`;
export const MAX_REQUESTS = 48;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function safeUrl(value) {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
}

export function validateTargetConfig(config) {
  invariant(['local', 'production'].includes(config.mode), 'target must be local or production');
  const api = safeUrl(config.apiUrl);
  if (config.mode === 'local') {
    invariant(['127.0.0.1', 'localhost'].includes(api.hostname), 'local audit refuses a non-local API host');
  } else {
    invariant(api.origin === PRODUCTION_API_ORIGIN, 'production audit refuses an unexpected Supabase project');
    invariant(config.confirmation === PRODUCTION_CONFIRMATION, 'production read-only confirmation is missing');
    invariant(config.workspaceLabel === 'Security E2E', 'production workspace label must be exactly Security E2E');
    invariant(UUID_PATTERN.test(config.workspaceId || ''), 'production Security E2E workspace UUID is required');
    invariant(UUID_PATTERN.test(config.foreignWorkspaceId || ''), 'production owner-only canary workspace UUID is required');
    invariant(config.workspaceId !== config.foreignWorkspaceId, 'target and canary workspaces must differ');
    invariant(UUID_PATTERN.test(config.targetOperationId || ''), 'production target operation UUID is required');
    invariant(UUID_PATTERN.test(config.foreignOperationId || ''), 'production owner-only operation UUID is required');
  }
  return { ...config, apiUrl: api.origin };
}

function createRecorder(mode) {
  const checks = [];
  let requestCount = 0;
  return {
    checks,
    countRequest() {
      requestCount += 1;
      invariant(requestCount <= MAX_REQUESTS, `request ceiling exceeded (${MAX_REQUESTS})`);
    },
    add(id, surface, passed, expected, actual, status) {
      checks.push({ id, surface, passed: Boolean(passed), expected, actual, ...(status ? { httpStatus: status } : {}) });
    },
    summary() {
      const passed = checks.filter((check) => check.passed).length;
      return { mode, requests: requestCount, checks: checks.length, passed, failed: checks.length - passed };
    },
  };
}

async function http(recorder, url, options = {}) {
  recorder.countRequest();
  const response = await fetch(url, { redirect: 'error', ...options });
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
  }
  return { status: response.status, body, headers: response.headers };
}

function authHeaders(apiKey, token, extra = {}) {
  return { apikey: apiKey, Authorization: `Bearer ${token}`, ...extra };
}

function jsonHeaders(apiKey, token, prefer = 'return=representation') {
  return authHeaders(apiKey, token, {
    'Content-Type': 'application/json',
    Prefer: prefer,
  });
}

function rows(result) {
  return Array.isArray(result.body) ? result.body : [];
}

async function createUser(recorder, apiUrl, serviceKey, email, password) {
  const proofToken = randomUUID();
  const proof = await http(recorder, `${apiUrl}/rest/v1/password_policy_proofs`, {
    method: 'POST',
    headers: jsonHeaders(serviceKey, serviceKey, 'return=minimal'),
    body: JSON.stringify({
      token: proofToken,
      purpose: 'signup',
      email,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    }),
  });
  invariant([200, 201].includes(proof.status), `local password proof creation failed (${proof.status})`);
  const result = await http(recorder, `${apiUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: jsonHeaders(serviceKey, serviceKey),
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { security_stage: '2.1', _password_policy_proof: proofToken },
    }),
  });
  invariant(result.status === 200, `local fixture user creation failed (${result.status})`);
  return { id: result.body.id, proofToken };
}

async function signIn(recorder, apiUrl, anonKey, email, password) {
  const result = await http(recorder, `${apiUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  invariant(result.status === 200 && result.body?.access_token, `local fixture sign-in failed (${result.status})`);
  return result.body.access_token;
}

async function adminRest(recorder, apiUrl, serviceKey, path, method = 'GET', body) {
  return http(recorder, `${apiUrl}/rest/v1/${path}`, {
    method,
    headers: jsonHeaders(serviceKey, serviceKey),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function userRest(recorder, config, token, path, method = 'GET', body) {
  return http(recorder, `${config.apiUrl}/rest/v1/${path}`, {
    method,
    headers: jsonHeaders(config.anonKey, token),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function edge(recorder, config, token, path, method = 'GET', body, extraHeaders = {}) {
  return http(recorder, `${config.apiUrl}/functions/v1/api/${path}`, {
    method,
    headers: { ...jsonHeaders(config.anonKey, token, 'return=representation'), ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function recordRowCount(recorder, id, surface, result, expected) {
  const actual = rows(result).length;
  recorder.add(id, surface, result.status === 200 && actual === expected, `${expected} visible row(s)`, `${actual} visible row(s)`, result.status);
}

async function runReadMatrix(recorder, config, fixture) {
  const targetQuery = `workspaces?id=eq.${fixture.workspaceId}&select=id,name`;
  const foreignQuery = `workspaces?id=eq.${fixture.foreignWorkspaceId}&select=id,name`;
  const targetOperationQuery = `operations?id=eq.${fixture.targetOperationId}&select=id,workspace_id`;
  const foreignOperationQuery = `operations?id=eq.${fixture.foreignOperationId}&select=id,workspace_id`;
  const compoundIdorQuery = `operations?workspace_id=eq.${fixture.workspaceId}&id=eq.${fixture.foreignOperationId}&select=id`;

  recordRowCount(recorder, 'rest.owner.target_workspace', 'PostgREST/RLS', await userRest(recorder, config, fixture.ownerToken, targetQuery), 1);
  recordRowCount(recorder, 'rest.member.target_workspace', 'PostgREST/RLS', await userRest(recorder, config, fixture.memberToken, targetQuery), 1);
  if (fixture.viewerToken) {
    recordRowCount(recorder, 'rest.viewer.target_workspace', 'PostgREST/RLS', await userRest(recorder, config, fixture.viewerToken, targetQuery), 1);
  }
  recordRowCount(recorder, 'rest.outsider.target_workspace', 'PostgREST/RLS', await userRest(recorder, config, fixture.outsiderToken, targetQuery), 0);
  recordRowCount(recorder, 'rest.member.foreign_workspace', 'PostgREST/RLS', await userRest(recorder, config, fixture.memberToken, foreignQuery), 0);
  recordRowCount(recorder, 'rest.owner.foreign_workspace', 'PostgREST/RLS', await userRest(recorder, config, fixture.ownerToken, foreignQuery), 1);
  recordRowCount(recorder, 'rest.member.target_operation', 'PostgREST/RLS', await userRest(recorder, config, fixture.memberToken, targetOperationQuery), 1);
  if (fixture.viewerToken) {
    recordRowCount(recorder, 'rest.viewer.target_operation', 'PostgREST/RLS', await userRest(recorder, config, fixture.viewerToken, targetOperationQuery), 1);
  }
  recordRowCount(recorder, 'rest.outsider.target_operation', 'PostgREST/RLS', await userRest(recorder, config, fixture.outsiderToken, targetOperationQuery), 0);
  recordRowCount(recorder, 'rest.member.foreign_operation', 'PostgREST/RLS', await userRest(recorder, config, fixture.memberToken, foreignOperationQuery), 0);
  recordRowCount(recorder, 'rest.compound_idor', 'PostgREST/RLS', await userRest(recorder, config, fixture.memberToken, compoundIdorQuery), 0);

  const memberEdge = await edge(recorder, config, fixture.memberToken, `workspaces/${fixture.workspaceId}/operations?limit=10`);
  const memberEdgeRows = Array.isArray(memberEdge.body?.data) ? memberEdge.body.data : Array.isArray(memberEdge.body) ? memberEdge.body : [];
  recorder.add('edge.member.target_operations', 'Edge api', memberEdge.status === 200 && memberEdgeRows.some((row) => row.id === fixture.targetOperationId), 'target operation visible', memberEdge.status === 200 ? `${memberEdgeRows.length} row(s)` : 'request rejected', memberEdge.status);

  const foreignEdge = await edge(recorder, config, fixture.memberToken, `workspaces/${fixture.foreignWorkspaceId}/operations?limit=10`);
  const foreignText = JSON.stringify(foreignEdge.body || {});
  recorder.add('edge.member.foreign_operations', 'Edge api/BOLA', foreignEdge.status < 500 && !foreignText.includes(fixture.foreignOperationId), 'no foreign object and no 5xx', foreignEdge.status < 500 ? 'foreign object absent' : '5xx response', foreignEdge.status);

  const invalidToken = await edge(recorder, config, 'invalid-stage21-token', `workspaces/${fixture.workspaceId}/operations?limit=1`);
  recorder.add('edge.invalid_token', 'Edge auth', [401, 403].includes(invalidToken.status), '401/403', String(invalidToken.status), invalidToken.status);
}

async function runLocalWriteMatrix(recorder, config, fixture) {
  const targetAccount = fixture.targetAccountId;
  const baseOperation = {
    workspace_id: fixture.workspaceId,
    amount: 1,
    type: 'expense',
    description: 'Security E2E HTTP member write',
    operation_date: new Date().toISOString().slice(0, 10),
    account_id: targetAccount,
    currency: 'KZT',
    exchange_rate: 1,
    base_amount: 1,
  };

  const memberWrite = await userRest(recorder, config, fixture.memberToken, 'operations?select=id', 'POST', { ...baseOperation, user_id: fixture.memberId });
  recorder.add('rest.member.target_write', 'PostgREST/RLS', [200, 201].includes(memberWrite.status) && rows(memberWrite).length === 1, 'member write succeeds once', `${rows(memberWrite).length} row(s)`, memberWrite.status);

  const viewerWrite = await userRest(recorder, config, fixture.viewerToken, 'operations?select=id', 'POST', { ...baseOperation, description: 'Security E2E forbidden viewer write', user_id: fixture.viewerId });
  recorder.add('rest.viewer.target_write', 'PostgREST/RLS', [401, 403].includes(viewerWrite.status), '401/403', String(viewerWrite.status), viewerWrite.status);

  const outsiderWrite = await userRest(recorder, config, fixture.outsiderToken, 'operations?select=id', 'POST', { ...baseOperation, description: 'Security E2E forbidden outsider write', user_id: fixture.outsiderId });
  recorder.add('rest.outsider.target_write', 'PostgREST/RLS', [401, 403].includes(outsiderWrite.status), '401/403', String(outsiderWrite.status), outsiderWrite.status);

  const foreignWrite = await userRest(recorder, config, fixture.memberToken, 'operations?select=id', 'POST', {
    ...baseOperation,
    workspace_id: fixture.foreignWorkspaceId,
    account_id: fixture.foreignAccountId,
    description: 'Security E2E forbidden foreign write',
    user_id: fixture.memberId,
  });
  recorder.add('rest.member.foreign_write', 'PostgREST/RLS/BOLA', [401, 403].includes(foreignWrite.status), '401/403', String(foreignWrite.status), foreignWrite.status);

  const selfPromotion = await userRest(
    recorder,
    config,
    fixture.memberToken,
    `workspace_members?workspace_id=eq.${fixture.workspaceId}&user_id=eq.${fixture.memberId}&select=user_id`,
    'PATCH',
    { role: 'Owner' },
  );
  recorder.add('rest.member.self_promotion', 'PostgREST/RLS', selfPromotion.status >= 400 && selfPromotion.status < 500, '4xx rejection', String(selfPromotion.status), selfPromotion.status);

  const crossAccount = await edge(
    recorder,
    config,
    fixture.memberToken,
    `workspaces/${fixture.workspaceId}/operations`,
    'POST',
    { ...baseOperation, account_id: fixture.foreignAccountId, description: 'Security E2E cross-account probe' },
    { 'Idempotency-Key': randomUUID() },
  );
  recorder.add('edge.cross_workspace_account', 'Edge api/BOLA', crossAccount.status >= 400 && crossAccount.status < 500, '4xx rejection without 5xx', String(crossAccount.status), crossAccount.status);
}

export async function runLocalHttpAudit(rawConfig) {
  const config = validateTargetConfig({ ...rawConfig, mode: 'local' });
  invariant(config.anonKey && config.serviceRoleKey, 'local anon and service-role keys are required');
  const recorder = createRecorder('local');
  const marker = randomUUID();
  const password = `Stage21-${randomUUID()}-aA1!`;
  const users = [];
  const proofTokens = [];
  let workspaceIds = [];
  let fixture;
  let cleanupRequestsPassed = true;

  try {
    const identities = {};
    for (const role of ['owner', 'member', 'viewer', 'outsider']) {
      const email = `stage21-${role}-${marker}@example.invalid`;
      const created = await createUser(recorder, config.apiUrl, config.serviceRoleKey, email, password);
      const { id } = created;
      proofTokens.push(created.proofToken);
      users.push(id);
      const token = await signIn(recorder, config.apiUrl, config.anonKey, email, password);
      identities[role] = { id, token };
    }

    const workspaceId = randomUUID();
    const foreignWorkspaceId = randomUUID();
    workspaceIds = [workspaceId, foreignWorkspaceId];
    let result = await adminRest(recorder, config.apiUrl, config.serviceRoleKey, 'workspaces', 'POST', [
      { id: workspaceId, owner_id: identities.owner.id, name: 'Security E2E', is_personal: false, workspace_type: 'personal' },
      { id: foreignWorkspaceId, owner_id: identities.owner.id, name: 'Security E2E owner-only', is_personal: false, workspace_type: 'personal' },
    ]);
    invariant([200, 201].includes(result.status), `workspace fixture creation failed (${result.status})`);

    result = await adminRest(recorder, config.apiUrl, config.serviceRoleKey, 'workspace_members', 'POST', [
      { workspace_id: workspaceId, user_id: identities.owner.id, role: 'Owner' },
      { workspace_id: workspaceId, user_id: identities.member.id, role: 'Member' },
      { workspace_id: workspaceId, user_id: identities.viewer.id, role: 'Viewer' },
      { workspace_id: foreignWorkspaceId, user_id: identities.owner.id, role: 'Owner' },
    ]);
    invariant([200, 201].includes(result.status), `membership fixture creation failed (${result.status})`);

    const accountResult = await adminRest(recorder, config.apiUrl, config.serviceRoleKey, `accounts?workspace_id=in.(${workspaceId},${foreignWorkspaceId})&is_default=eq.true&select=id,workspace_id`);
    invariant(accountResult.status === 200 && rows(accountResult).length === 2, 'default account fixture is incomplete');
    const targetAccountId = rows(accountResult).find((row) => row.workspace_id === workspaceId)?.id;
    const foreignAccountId = rows(accountResult).find((row) => row.workspace_id === foreignWorkspaceId)?.id;
    invariant(targetAccountId && foreignAccountId, 'default account IDs are missing');

    const targetOperationId = randomUUID();
    const foreignOperationId = randomUUID();
    result = await adminRest(recorder, config.apiUrl, config.serviceRoleKey, 'operations', 'POST', [
      { id: targetOperationId, workspace_id: workspaceId, user_id: identities.owner.id, amount: 10, type: 'expense', description: 'Security E2E HTTP target', operation_date: new Date().toISOString().slice(0, 10), account_id: targetAccountId, currency: 'KZT', exchange_rate: 1, base_amount: 10 },
      { id: foreignOperationId, workspace_id: foreignWorkspaceId, user_id: identities.owner.id, amount: 20, type: 'expense', description: 'Security E2E HTTP owner-only', operation_date: new Date().toISOString().slice(0, 10), account_id: foreignAccountId, currency: 'KZT', exchange_rate: 1, base_amount: 20 },
    ]);
    invariant([200, 201].includes(result.status), `operation fixture creation failed (${result.status})`);

    fixture = {
      workspaceId,
      foreignWorkspaceId,
      targetOperationId,
      foreignOperationId,
      targetAccountId,
      foreignAccountId,
      ownerToken: identities.owner.token,
      memberToken: identities.member.token,
      viewerToken: identities.viewer.token,
      outsiderToken: identities.outsider.token,
      memberId: identities.member.id,
      viewerId: identities.viewer.id,
      outsiderId: identities.outsider.id,
    };

    await runReadMatrix(recorder, config, fixture);
    await runLocalWriteMatrix(recorder, config, fixture);
  } finally {
    let ownedWorkspaceIds = [...workspaceIds];
    if (users.length) {
      const owned = await adminRest(
        recorder,
        config.apiUrl,
        config.serviceRoleKey,
        `workspaces?owner_id=in.(${users.join(',')})&select=id`,
      ).catch(() => null);
      cleanupRequestsPassed &&= Boolean(owned?.status === 200);
      ownedWorkspaceIds = [...new Set([...ownedWorkspaceIds, ...rows(owned || {}).map((row) => row.id)])];
    }
    if (ownedWorkspaceIds.length) {
      const accountUnlock = await adminRest(
        recorder,
        config.apiUrl,
        config.serviceRoleKey,
        `accounts?workspace_id=in.(${ownedWorkspaceIds.join(',')})&is_default=eq.true`,
        'PATCH',
        { is_default: false },
      ).catch(() => null);
      cleanupRequestsPassed &&= Boolean(accountUnlock && [200, 204].includes(accountUnlock.status));
      const workspaceDelete = await adminRest(
        recorder,
        config.apiUrl,
        config.serviceRoleKey,
        `workspaces?id=in.(${ownedWorkspaceIds.join(',')})`,
        'DELETE',
      ).catch(() => null);
      cleanupRequestsPassed &&= Boolean(workspaceDelete && [200, 204].includes(workspaceDelete.status));
    }
    for (const userId of users) {
      const userDelete = await http(recorder, `${config.apiUrl}/auth/v1/admin/users/${userId}`, {
        method: 'DELETE',
        headers: authHeaders(config.serviceRoleKey, config.serviceRoleKey),
      }).catch(() => null);
      cleanupRequestsPassed &&= Boolean(userDelete && [200, 204].includes(userDelete.status));
    }
    if (proofTokens.length) {
      const proofDelete = await adminRest(
        recorder,
        config.apiUrl,
        config.serviceRoleKey,
        `password_policy_proofs?token=in.(${proofTokens.join(',')})`,
        'DELETE',
      ).catch(() => null);
      cleanupRequestsPassed &&= Boolean(proofDelete && [200, 204].includes(proofDelete.status));
    }
  }

  const cleanupFilters = [];
  if (workspaceIds.length) cleanupFilters.push(`id.in.(${workspaceIds.join(',')})`);
  if (users.length) cleanupFilters.push(`owner_id.in.(${users.join(',')})`);
  const cleanupPath = cleanupFilters.length > 1
    ? `workspaces?or=(${cleanupFilters.join(',')})&select=id`
    : `workspaces?${cleanupFilters[0] || 'id=is.null'}&select=id`;
  const cleanup = await adminRest(recorder, config.apiUrl, config.serviceRoleKey, cleanupPath);
  const usersAfterCleanup = await http(recorder, `${config.apiUrl}/auth/v1/admin/users?page=1&per_page=1000`, {
    headers: authHeaders(config.serviceRoleKey, config.serviceRoleKey),
  });
  const remainingUsers = Array.isArray(usersAfterCleanup.body?.users)
    ? usersAfterCleanup.body.users.filter((user) => users.includes(user.id)).length
    : users.length;
  const cleanupPassed = cleanupRequestsPassed
    && cleanup.status === 200
    && rows(cleanup).length === 0
    && usersAfterCleanup.status === 200
    && remainingUsers === 0;
  recorder.add(
    'fixture.cleanup',
    'Local fixture',
    cleanupPassed,
    '0 remaining workspaces and users',
    `${rows(cleanup).length} workspace(s), ${remainingUsers} user(s)`,
    cleanup.status,
  );
  return { stage: '2.1', target: 'local', checks: recorder.checks, summary: recorder.summary(), cleanup: { passed: cleanupPassed } };
}

function decodeJwtSubject(token) {
  const parts = String(token || '').split('.');
  invariant(parts.length === 3, 'a short-lived JWT access token is required');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  invariant(typeof payload.sub === 'string', 'JWT subject is missing');
  return payload.sub;
}

export async function runProductionReadOnlyAudit(rawConfig) {
  const config = validateTargetConfig({ ...rawConfig, mode: 'production' });
  invariant(config.anonKey && config.ownerToken && config.memberToken && config.outsiderToken, 'production read-only audit requires anon, owner, member and outsider tokens');
  const subjects = new Set([config.ownerToken, config.memberToken, config.outsiderToken].map(decodeJwtSubject));
  invariant(subjects.size === 3, 'production tokens must belong to three different users');
  const recorder = createRecorder('production-read-only');
  const fixture = {
    workspaceId: config.workspaceId,
    foreignWorkspaceId: config.foreignWorkspaceId,
    targetOperationId: config.targetOperationId,
    foreignOperationId: config.foreignOperationId,
    ownerToken: config.ownerToken,
    memberToken: config.memberToken,
    viewerToken: null,
    outsiderToken: config.outsiderToken,
  };
  await runReadMatrix(recorder, config, fixture);
  return { stage: '2.1', target: 'production-read-only', checks: recorder.checks, summary: recorder.summary(), cleanup: { passed: true, note: 'read-only mode created no fixture' } };
}

async function cli() {
  const modeIndex = process.argv.indexOf('--target');
  const mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : 'production';
  invariant(mode === 'production', 'direct HTTP CLI supports production read-only only; use the orchestrator for local mode');
  const report = await runProductionReadOnlyAudit({
    apiUrl: process.env.STAGE21_API_URL || PRODUCTION_API_ORIGIN,
    confirmation: process.env.STAGE21_PRODUCTION_CONFIRM,
    workspaceLabel: process.env.STAGE21_WORKSPACE_LABEL,
    workspaceId: process.env.STAGE21_WORKSPACE_ID,
    foreignWorkspaceId: process.env.STAGE21_FOREIGN_WORKSPACE_ID,
    targetOperationId: process.env.STAGE21_TARGET_OPERATION_ID,
    foreignOperationId: process.env.STAGE21_FOREIGN_OPERATION_ID,
    anonKey: process.env.STAGE21_ANON_KEY,
    ownerToken: process.env.STAGE21_OWNER_TOKEN,
    memberToken: process.env.STAGE21_MEMBER_TOKEN,
    outsiderToken: process.env.STAGE21_OUTSIDER_TOKEN,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.summary.failed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  cli().catch((error) => {
    console.error(`Stage 2.1 HTTP runner stopped: ${error.message}`);
    process.exitCode = 1;
  });
}
