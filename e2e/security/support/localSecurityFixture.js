import { test as base, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function localConfig() {
  invariant(process.env.E2E_LOCAL_ONLY === '1', 'synthetic fixture requires E2E_LOCAL_ONLY=1');
  const api = new URL(process.env.E2E_SUPABASE_URL || '');
  invariant(api.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(api.hostname), 'fixture refuses a non-loopback Supabase API');
  invariant(process.env.E2E_ANON_KEY && process.env.E2E_SERVICE_ROLE_KEY, 'local Supabase keys are missing');
  return {
    apiUrl: api.origin,
    anonKey: process.env.E2E_ANON_KEY,
    serviceKey: process.env.E2E_SERVICE_ROLE_KEY,
  };
}

async function http(config, path, { token = config.serviceKey, method = 'GET', body, prefer = 'return=representation' } = {}) {
  const response = await fetch(`${config.apiUrl}${path}`, {
    method,
    redirect: 'error',
    headers: {
      apikey: token === config.serviceKey ? config.serviceKey : config.anonKey,
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', Prefer: prefer }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { status: response.status, data };
}

async function createIdentity(config, role, marker, password) {
  const email = `stage42-${role}-${marker}@example.invalid`;
  const proofToken = randomUUID();
  let result = await http(config, '/rest/v1/password_policy_proofs', {
    method: 'POST',
    body: { token: proofToken, purpose: 'signup', email, expires_at: new Date(Date.now() + 60_000).toISOString() },
    prefer: 'return=minimal',
  });
  invariant([200, 201].includes(result.status), `password proof creation failed (${result.status})`);
  result = await http(config, '/auth/v1/admin/users', {
    method: 'POST',
    body: {
      email,
      password,
      email_confirm: true,
      user_metadata: { security_stage: '4.2-browser', _password_policy_proof: proofToken },
    },
  });
  invariant(result.status === 200 && result.data?.id, `synthetic ${role} creation failed (${result.status})`);
  const id = result.data.id;
  result = await fetch(`${config.apiUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: config.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const signedIn = await result.json();
  invariant(result.status === 200 && signedIn.access_token, `synthetic ${role} sign-in failed (${result.status})`);
  return { role, email, password, id, token: signedIn.access_token, proofToken };
}

async function createFixture() {
  const config = localConfig();
  const marker = randomUUID();
  const password = `Stage42-${randomUUID()}-aA1!`;
  const identities = {};
  const workspaceIds = [];
  let ready = false;

  try {
    for (const role of ['owner', 'member', 'viewer', 'outsider']) {
      identities[role] = await createIdentity(config, role, marker, password);
    }

    const sharedId = randomUUID();
    const ownerPrivateId = randomUUID();
    const outsiderPrivateId = randomUUID();
    workspaceIds.push(sharedId, ownerPrivateId, outsiderPrivateId);
    const suffix = marker.slice(0, 8);
    let result = await http(config, '/rest/v1/workspaces', {
      method: 'POST',
      body: [
        { id: sharedId, owner_id: identities.owner.id, name: `Security shared ${suffix}`, is_personal: false, workspace_type: 'personal' },
        { id: ownerPrivateId, owner_id: identities.owner.id, name: `Owner private ${suffix}`, is_personal: false, workspace_type: 'personal' },
        { id: outsiderPrivateId, owner_id: identities.outsider.id, name: `Outsider private ${suffix}`, is_personal: false, workspace_type: 'personal' },
      ],
    });
    invariant([200, 201].includes(result.status), `workspace fixture creation failed (${result.status})`);

    result = await http(config, '/rest/v1/workspace_members', {
      method: 'POST',
      body: [
        { workspace_id: sharedId, user_id: identities.owner.id, role: 'Owner' },
        { workspace_id: sharedId, user_id: identities.member.id, role: 'Member' },
        { workspace_id: sharedId, user_id: identities.viewer.id, role: 'Viewer' },
        { workspace_id: ownerPrivateId, user_id: identities.owner.id, role: 'Owner' },
        { workspace_id: outsiderPrivateId, user_id: identities.outsider.id, role: 'Owner' },
      ],
    });
    invariant([200, 201].includes(result.status), `membership fixture creation failed (${result.status})`);

    result = await http(config, `/rest/v1/accounts?workspace_id=in.(${workspaceIds.join(',')})&is_default=eq.true&select=id,workspace_id`);
    invariant(result.status === 200 && Array.isArray(result.data) && result.data.length === 3, 'default accounts are incomplete');
    const accountFor = (workspaceId) => result.data.find((row) => row.workspace_id === workspaceId)?.id;
    const sharedAccountId = accountFor(sharedId);
    const ownerPrivateAccountId = accountFor(ownerPrivateId);
    const outsiderPrivateAccountId = accountFor(outsiderPrivateId);
    invariant(sharedAccountId && ownerPrivateAccountId && outsiderPrivateAccountId, 'default account IDs are missing');

    const ownerCanaryId = randomUUID();
    const outsiderCanaryId = randomUUID();
    const ownerCanary = `OWNER-CANARY-${suffix}`;
    const outsiderCanary = `OUTSIDER-CANARY-${suffix}`;
    result = await http(config, '/rest/v1/operations', {
      method: 'POST',
      body: [
        { id: ownerCanaryId, workspace_id: ownerPrivateId, user_id: identities.owner.id, amount: 41, type: 'expense', description: ownerCanary, operation_date: new Date().toISOString().slice(0, 10), account_id: ownerPrivateAccountId, currency: 'KZT', exchange_rate: 1, base_amount: 41 },
        { id: outsiderCanaryId, workspace_id: outsiderPrivateId, user_id: identities.outsider.id, amount: 42, type: 'expense', description: outsiderCanary, operation_date: new Date().toISOString().slice(0, 10), account_id: outsiderPrivateAccountId, currency: 'KZT', exchange_rate: 1, base_amount: 42 },
      ],
    });
    invariant([200, 201].includes(result.status), `canary operation creation failed (${result.status})`);

    ready = true;
    return {
      config,
      marker,
      identities,
      workspaces: {
        shared: { id: sharedId, name: `Security shared ${suffix}`, accountId: sharedAccountId },
        ownerPrivate: { id: ownerPrivateId, name: `Owner private ${suffix}`, accountId: ownerPrivateAccountId, canaryId: ownerCanaryId, canary: ownerCanary },
        outsiderPrivate: { id: outsiderPrivateId, name: `Outsider private ${suffix}`, accountId: outsiderPrivateAccountId, canaryId: outsiderCanaryId, canary: outsiderCanary },
      },
      async as(role, path, options = {}) {
        return http(config, `/rest/v1/${path}`, { ...options, token: identities[role].token });
      },
      async admin(path, options = {}) {
        return http(config, `/rest/v1/${path}`, options);
      },
    };
  } catch (error) {
    error.fixtureState = { config, identities, workspaceIds };
    throw error;
  } finally {
    if (!ready) await cleanupFixture({ config, identities, workspaceIds }).catch(() => {});
  }
}

async function cleanupFixture(fixture) {
  const { config, identities, workspaceIds = [] } = fixture;
  const userIds = Object.values(identities || {}).map((identity) => identity.id).filter(Boolean);
  let ownedIds = [...workspaceIds];
  if (userIds.length) {
    const owned = await http(config, `/rest/v1/workspaces?owner_id=in.(${userIds.join(',')})&select=id`);
    if (owned.status === 200 && Array.isArray(owned.data)) ownedIds = [...new Set([...ownedIds, ...owned.data.map((row) => row.id)])];
  }
  if (ownedIds.length) {
    await http(config, `/rest/v1/accounts?workspace_id=in.(${ownedIds.join(',')})&is_default=eq.true`, { method: 'PATCH', body: { is_default: false }, prefer: 'return=minimal' });
    const deleted = await http(config, `/rest/v1/workspaces?id=in.(${ownedIds.join(',')})`, { method: 'DELETE', prefer: 'return=minimal' });
    invariant([200, 204].includes(deleted.status), `workspace cleanup failed (${deleted.status})`);
  }
  for (const identity of Object.values(identities || {})) {
    if (!identity.id) continue;
    const deleted = await http(config, `/auth/v1/admin/users/${identity.id}`, { method: 'DELETE' });
    invariant([200, 204].includes(deleted.status), `user cleanup failed (${deleted.status})`);
  }
  const remaining = ownedIds.length
    ? await http(config, `/rest/v1/workspaces?id=in.(${ownedIds.join(',')})&select=id`)
    : { status: 200, data: [] };
  const usersAfterCleanup = await http(config, '/auth/v1/admin/users?page=1&per_page=1000');
  const remainingUserIds = Array.isArray(usersAfterCleanup.data?.users)
    ? usersAfterCleanup.data.users.map((user) => user.id).filter((id) => userIds.includes(id))
    : userIds;
  invariant(remaining.status === 200 && Array.isArray(remaining.data) && remaining.data.length === 0, 'synthetic workspace cleanup was not complete');
  invariant(
    usersAfterCleanup.status === 200 && remainingUserIds.length === 0,
    'synthetic Auth user cleanup was not complete',
  );
}

export const test = base.extend({
  securityFixture: async ({ playwright }, use) => {
    void playwright;
    const fixture = await createFixture();
    try {
      await use(fixture);
    } finally {
      await cleanupFixture({
        config: fixture.config,
        identities: fixture.identities,
        workspaceIds: Object.values(fixture.workspaces).map((workspace) => workspace.id),
      });
    }
  },
});

export { expect };
