import { test, expect } from './support/localSecurityFixture.js';
import { createExpense, expectPrivateBrowserStateCleared, login, logout, openWorkspace } from './support/browserActions.js';

test('@sequential one browser context keeps accounts and private workspaces isolated', async ({ page, securityFixture: fixture }) => {
  const { identities, workspaces } = fixture;
  const sharedMarker = `SEQ-SHARED-${fixture.marker.slice(0, 8)}`;

  await login(page, identities.owner);
  await openWorkspace(page, workspaces.shared);
  await createExpense(page, sharedMarker, '17');
  await logout(page);
  await expectPrivateBrowserStateCleared(page);

  await login(page, identities.outsider);
  await page.goto(`/workspace/${workspaces.ownerPrivate.id}`);
  await expect(page.getByText('Нет доступа к рабочему пространству')).toBeVisible();
  let result = await fixture.as('outsider', `operations?id=eq.${workspaces.ownerPrivate.canaryId}&select=id,description,amount`);
  expect(result.status).toBe(200);
  expect(result.data).toEqual([]);
  await logout(page);
  await expectPrivateBrowserStateCleared(page);

  await login(page, identities.member);
  await openWorkspace(page, workspaces.shared);
  await expect(page.getByText(sharedMarker, { exact: true })).toBeVisible();
  result = await fixture.as('member', `operations?id=eq.${workspaces.ownerPrivate.canaryId}&select=id,description,amount`);
  expect(result.status).toBe(200);
  expect(result.data).toEqual([]);
  await logout(page);
  await expectPrivateBrowserStateCleared(page);

  await login(page, identities.viewer);
  await openWorkspace(page, workspaces.shared);
  await expect(page.getByText(sharedMarker, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Расход', exact: true })).toBeDisabled();
  result = await fixture.as('viewer', 'operations?select=id', {
    method: 'POST',
    body: {
      workspace_id: workspaces.shared.id,
      user_id: identities.viewer.id,
      account_id: workspaces.shared.accountId,
      amount: 99,
      base_amount: 99,
      type: 'expense',
      description: 'FORBIDDEN-VIEWER-WRITE',
      operation_date: new Date().toISOString().slice(0, 10),
      currency: 'KZT',
      exchange_rate: 1,
    },
  });
  expect(result.status).toBeGreaterThanOrEqual(400);
  expect(result.status).toBeLessThan(500);

  const canary = await fixture.admin(`operations?id=eq.${workspaces.ownerPrivate.canaryId}&select=id,description,amount`);
  expect(canary.status).toBe(200);
  expect(canary.data).toEqual([{ id: workspaces.ownerPrivate.canaryId, description: workspaces.ownerPrivate.canary, amount: 41 }]);
});
