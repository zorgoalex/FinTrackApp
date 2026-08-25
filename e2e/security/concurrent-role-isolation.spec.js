import { test, expect } from './support/localSecurityFixture.js';
import { createExpense, login, openWorkspace } from './support/browserActions.js';

test('@concurrent isolated contexts exercise simultaneous roles and cross-access denial', async ({ browser, securityFixture: fixture }) => {
  const roles = ['owner', 'member', 'viewer', 'outsider'];
  const contexts = Object.fromEntries(await Promise.all(roles.map(async (role) => [role, await browser.newContext()])));
  const pages = Object.fromEntries(await Promise.all(roles.map(async (role) => [role, await contexts[role].newPage()])));
  const ownerMarker = `CONCURRENT-OWNER-${fixture.marker.slice(0, 8)}`;
  const memberMarker = `CONCURRENT-MEMBER-${fixture.marker.slice(0, 8)}`;

  try {
    await Promise.all(roles.map((role) => login(pages[role], fixture.identities[role])));
    await Promise.all([
      openWorkspace(pages.owner, fixture.workspaces.shared),
      openWorkspace(pages.member, fixture.workspaces.shared),
      openWorkspace(pages.viewer, fixture.workspaces.shared),
      openWorkspace(pages.outsider, fixture.workspaces.outsiderPrivate),
    ]);

    const forbiddenViewer = fixture.as('viewer', 'operations?select=id', {
      method: 'POST',
      body: {
        workspace_id: fixture.workspaces.shared.id,
        user_id: fixture.identities.viewer.id,
        account_id: fixture.workspaces.shared.accountId,
        amount: 91,
        base_amount: 91,
        type: 'expense',
        description: 'FORBIDDEN-CONCURRENT-VIEWER',
        operation_date: new Date().toISOString().slice(0, 10),
        currency: 'KZT',
        exchange_rate: 1,
      },
    });
    const forbiddenOutsider = fixture.as('outsider', 'operations?select=id', {
      method: 'POST',
      body: {
        workspace_id: fixture.workspaces.shared.id,
        user_id: fixture.identities.outsider.id,
        account_id: fixture.workspaces.shared.accountId,
        amount: 92,
        base_amount: 92,
        type: 'expense',
        description: 'FORBIDDEN-CONCURRENT-OUTSIDER',
        operation_date: new Date().toISOString().slice(0, 10),
        currency: 'KZT',
        exchange_rate: 1,
      },
    });
    const [viewerWrite, outsiderWrite] = await Promise.all([
      forbiddenViewer,
      forbiddenOutsider,
      createExpense(pages.owner, ownerMarker, '31'),
      createExpense(pages.member, memberMarker, '32'),
    ]);
    for (const denied of [viewerWrite, outsiderWrite]) {
      expect(denied.status).toBeGreaterThanOrEqual(400);
      expect(denied.status).toBeLessThan(500);
    }

    await Promise.all(['owner', 'member', 'viewer'].map(async (role) => {
      await pages[role].reload();
      await expect(pages[role].getByText(ownerMarker, { exact: true })).toBeVisible();
      await expect(pages[role].getByText(memberMarker, { exact: true })).toBeVisible();
    }));

    const crossReads = await Promise.all([
      fixture.as('member', `operations?id=eq.${fixture.workspaces.ownerPrivate.canaryId}&select=id`),
      fixture.as('viewer', `operations?id=eq.${fixture.workspaces.ownerPrivate.canaryId}&select=id`),
      fixture.as('outsider', `operations?id=eq.${fixture.workspaces.ownerPrivate.canaryId}&select=id`),
      fixture.as('owner', `operations?id=eq.${fixture.workspaces.outsiderPrivate.canaryId}&select=id`),
    ]);
    for (const read of crossReads) {
      expect(read.status).toBe(200);
      expect(read.data).toEqual([]);
    }

    const downgrade = await fixture.as(
      'owner',
      `workspace_members?workspace_id=eq.${fixture.workspaces.shared.id}&user_id=eq.${fixture.identities.member.id}&select=user_id,role`,
      { method: 'PATCH', body: { role: 'Viewer' } },
    );
    expect(downgrade.status).toBe(200);
    expect(downgrade.data).toEqual([{ user_id: fixture.identities.member.id, role: 'Viewer' }]);

    const downgradedWrite = await fixture.as('member', 'operations?select=id', {
      method: 'POST',
      body: {
        workspace_id: fixture.workspaces.shared.id,
        user_id: fixture.identities.member.id,
        account_id: fixture.workspaces.shared.accountId,
        amount: 93,
        base_amount: 93,
        type: 'expense',
        description: 'FORBIDDEN-AFTER-DOWNGRADE',
        operation_date: new Date().toISOString().slice(0, 10),
        currency: 'KZT',
        exchange_rate: 1,
      },
    });
    expect(downgradedWrite.status).toBeGreaterThanOrEqual(400);
    expect(downgradedWrite.status).toBeLessThan(500);
    await pages.member.reload();
    await expect(pages.member.getByRole('button', { name: '+ Расход', exact: true })).toBeDisabled();

    const canaries = await Promise.all([
      fixture.admin(`operations?id=eq.${fixture.workspaces.ownerPrivate.canaryId}&select=id,description,amount`),
      fixture.admin(`operations?id=eq.${fixture.workspaces.outsiderPrivate.canaryId}&select=id,description,amount`),
    ]);
    expect(canaries[0].data).toEqual([{ id: fixture.workspaces.ownerPrivate.canaryId, description: fixture.workspaces.ownerPrivate.canary, amount: 41 }]);
    expect(canaries[1].data).toEqual([{ id: fixture.workspaces.outsiderPrivate.canaryId, description: fixture.workspaces.outsiderPrivate.canary, amount: 42 }]);
  } finally {
    await Promise.all(Object.values(contexts).map((context) => context.close()));
  }
});
