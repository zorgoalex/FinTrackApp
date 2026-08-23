const DATABASE_NAME = 'fintrack-offline';
const FINTRACK_CACHE_PREFIX = 'fintrack-';
const OFFLINE_STORAGE_PREFERENCE = 'fintrack:offline-storage-enabled';
const PRIVATE_LOCAL_STORAGE_KEYS = ['user', 'lastWorkspaceId'];
const PRIVATE_LOCAL_STORAGE_PREFIXES = [
  'dashboardBlocks_',
  'visibleAccounts_',
  'accountsSummaryOnly_',
];

export const OFFLINE_FINANCIAL_STORAGE_ENABLED = false;

export function isOfflineStorageEnabled() {
  return OFFLINE_FINANCIAL_STORAGE_ENABLED;
}

export async function setOfflineStorageEnabled() {
  if (typeof globalThis.localStorage !== 'undefined') {
    globalThis.localStorage.setItem(OFFLINE_STORAGE_PREFERENCE, 'false');
  }
  await clearLocalFinancialData();
}

export async function cacheReference() {
  // Financial reference caching is intentionally disabled for the beta.
}

export async function getCachedReference() {
  return null;
}

export async function enqueueOfflineExpense() {
  throw new Error('Для создания операции требуется подключение к интернету');
}

export async function clearOfflineDataForUser() {
  if (typeof globalThis.indexedDB === 'undefined') return;
  await new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('Не удалось удалить offline-хранилище'));
    request.onblocked = () => resolve();
  });
}

export async function clearFinTrackCaches() {
  if (typeof globalThis.caches === 'undefined') return;
  const cacheNames = await globalThis.caches.keys();
  await Promise.all(cacheNames
    .filter((cacheName) => cacheName.startsWith(FINTRACK_CACHE_PREFIX))
    .map((cacheName) => globalThis.caches.delete(cacheName)));
}

export async function clearLocalFinancialData() {
  await Promise.all([
    setOfflinePreferenceDisabled(),
    clearOfflineDataForUser(),
    clearFinTrackCaches(),
  ]);
}

export function clearLocalPrivacyData() {
  if (typeof globalThis.localStorage === 'undefined') return;

  for (const key of PRIVATE_LOCAL_STORAGE_KEYS) {
    globalThis.localStorage.removeItem(key);
  }

  const keysToRemove = [];
  for (let index = 0; index < globalThis.localStorage.length; index += 1) {
    const key = globalThis.localStorage.key(index);
    if (key && PRIVATE_LOCAL_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      keysToRemove.push(key);
    }
  }
  for (const key of keysToRemove) globalThis.localStorage.removeItem(key);
}

function setOfflinePreferenceDisabled() {
  if (typeof globalThis.localStorage !== 'undefined') {
    globalThis.localStorage.setItem(OFFLINE_STORAGE_PREFERENCE, 'false');
  }
}
