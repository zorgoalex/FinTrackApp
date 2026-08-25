import { expect } from '@playwright/test';

export async function login(page, identity) {
  if (new URL(page.url()).pathname !== '/login') await page.goto('/login');
  await page.getByPlaceholder('Email или логин').fill(identity.email);
  await page.getByPlaceholder('Пароль').fill(identity.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
  await expect(page.getByPlaceholder('Email или логин')).toBeHidden();
  const workspaceSelector = page.getByRole('heading', { name: 'Выберите рабочее пространство' });
  const authenticatedLayout = page.getByRole('button', { name: 'Выйти', exact: true });
  await expect(workspaceSelector.or(authenticatedLayout)).toBeVisible();
}

export async function logout(page) {
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await page.waitForURL(/\/login(?:$|[/?#])/);
}

export async function openWorkspace(page, workspace) {
  await page.goto(`/workspace/${workspace.id}`);
  await expect(page.getByRole('heading', { name: workspace.name })).toBeVisible();
}

export async function createExpense(page, marker, amount = '17') {
  await page.getByRole('button', { name: '+ Расход', exact: true }).click();
  const modalHeading = page.getByRole('heading', { name: 'Новая операция — Расход' });
  await expect(modalHeading).toBeVisible();
  await page.getByLabel(/Сумма операции,/).fill(amount);
  await page.getByLabel('Описание операции').fill(marker);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(modalHeading).toBeHidden();
  await expect(page.getByText(marker, { exact: true })).toBeVisible();
}

export async function expectPrivateBrowserStateCleared(page) {
  const leftovers = await page.evaluate(async () => {
    const localKeys = Object.keys(localStorage).filter((key) => (
      key === 'user'
      || key === 'lastWorkspaceId'
      || key.startsWith('fintrack-')
      || (key.startsWith('sb-') && key.endsWith('-auth-token'))
    ));
    const databases = typeof indexedDB.databases === 'function'
      ? (await indexedDB.databases()).map((database) => database.name).filter(Boolean)
      : [];
    const cacheNames = 'caches' in window ? await caches.keys() : [];
    return {
      localKeys,
      databases: databases.filter((name) => name === 'fintrack-offline'),
      cacheNames: cacheNames.filter((name) => name.startsWith('fintrack-')),
    };
  });
  expect(leftovers).toEqual({ localKeys: [], databases: [], cacheNames: [] });
}
