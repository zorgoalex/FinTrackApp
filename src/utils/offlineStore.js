const DATABASE_NAME = 'fintrack-offline';
const DATABASE_VERSION = 2;
const QUEUE_STORE = 'operation-queue';
const REFERENCE_STORE = 'reference-cache';
const FINTRACK_CACHE_PREFIX = 'fintrack-';
const OFFLINE_STORAGE_PREFERENCE = 'fintrack:offline-storage-enabled';

export const OFFLINE_QUEUE_CHANGED = 'fintrack:offline-queue-changed';
export const OFFLINE_SYNC_COMPLETED = 'fintrack:offline-sync-completed';

export function isOfflineExpenseType(type) {
  return type === 'expense' || type === 'employee_salary';
}

export function buildReferenceKey(userId, kind, id) {
  if (!userId || !kind || !id) return null;
  return `${userId}:${kind}:${id}`;
}

export function isOwnedOfflineRecord(record, userId) {
  return Boolean(userId && record?.user_id === userId);
}

export function isOfflineStorageEnabled() {
  if (typeof globalThis.localStorage === 'undefined') return true;
  return globalThis.localStorage.getItem(OFFLINE_STORAGE_PREFERENCE) !== 'false';
}

export async function setOfflineStorageEnabled(enabled, userId) {
  if (typeof globalThis.localStorage !== 'undefined') {
    globalThis.localStorage.setItem(OFFLINE_STORAGE_PREFERENCE, enabled ? 'true' : 'false');
  }
  if (!enabled) await clearLocalFinancialData(userId);
}

function createStores(database) {
  if (!database.objectStoreNames.contains(QUEUE_STORE)) {
    const queue = database.createObjectStore(QUEUE_STORE, { keyPath: 'client_request_id' });
    queue.createIndex('user_id', 'user_id', { unique: false });
    queue.createIndex('user_workspace', ['user_id', 'workspace_id'], { unique: false });
    queue.createIndex('state', 'state', { unique: false });
  }
  if (!database.objectStoreNames.contains(REFERENCE_STORE)) {
    const references = database.createObjectStore(REFERENCE_STORE, { keyPath: 'key' });
    references.createIndex('user_id', 'user_id', { unique: false });
  }
}

function openDatabase() {
  if (typeof globalThis.indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB недоступна'));
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error || new Error('Не удалось открыть offline-хранилище'));
    request.onupgradeneeded = (event) => {
      const database = request.result;
      // Version 1 records have no owner. They cannot be attributed safely, so
      // discard them instead of exposing them to the next browser user.
      if (event.oldVersion > 0 && event.oldVersion < DATABASE_VERSION) {
        if (database.objectStoreNames.contains(QUEUE_STORE)) database.deleteObjectStore(QUEUE_STORE);
        if (database.objectStoreNames.contains(REFERENCE_STORE)) database.deleteObjectStore(REFERENCE_STORE);
      }
      createStores(database);
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function runTransaction(storeName, mode, action) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let result;
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Ошибка offline-хранилища'));
    };
    transaction.onabort = transaction.onerror;
    try {
      result = action(store);
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function emit(name, detail) {
  if (typeof window !== 'undefined') window.dispatchEvent(new window.CustomEvent(name, { detail }));
}

export async function cacheReference(userId, kind, id, value) {
  if (!isOfflineStorageEnabled()) return;
  const key = buildReferenceKey(userId, kind, id);
  if (!key || value == null) return;
  await runTransaction(REFERENCE_STORE, 'readwrite', (store) => {
    store.put({
      key,
      user_id: userId,
      kind,
      reference_id: String(id),
      value,
      updated_at: new Date().toISOString(),
    });
  });
}

export async function getCachedReference(userId, kind, id) {
  if (!isOfflineStorageEnabled()) return null;
  const key = buildReferenceKey(userId, kind, id);
  if (!key) return null;
  let request;
  await runTransaction(REFERENCE_STORE, 'readonly', (store) => {
    request = requestResult(store.get(key));
  });
  const record = await request;
  return isOwnedOfflineRecord(record, userId) ? record.value : null;
}

export async function enqueueOfflineExpense({ userId, workspaceId, payload }) {
  if (!userId) throw new Error('Не удалось определить пользователя для офлайн-операции');
  if (!isOfflineStorageEnabled()) throw new Error('Офлайн-хранение отключено в личном кабинете');
  if (!workspaceId || !payload || !isOfflineExpenseType(payload.p_type)) {
    throw new Error('Офлайн можно добавить только расход');
  }
  const clientRequestId = globalThis.crypto.randomUUID();
  const record = {
    client_request_id: clientRequestId,
    user_id: userId,
    workspace_id: workspaceId,
    payload,
    state: 'pending',
    error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await runTransaction(QUEUE_STORE, 'readwrite', (store) => store.add(record));
  emit(OFFLINE_QUEUE_CHANGED, { userId, workspaceId });
  return record;
}

export async function listOfflineExpenses(userId, workspaceId) {
  if (!isOfflineStorageEnabled() || !userId || !workspaceId) return [];
  let request;
  await runTransaction(QUEUE_STORE, 'readonly', (store) => {
    request = requestResult(store.index('user_workspace').getAll([userId, workspaceId]));
  });
  return (await request || [])
    .filter((record) => isOwnedOfflineRecord(record, userId))
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
}

async function updateQueueRecord(record, userId) {
  if (!isOwnedOfflineRecord(record, userId)) return false;
  await runTransaction(QUEUE_STORE, 'readwrite', (store) => store.put({
    ...record,
    updated_at: new Date().toISOString(),
  }));
  return true;
}

async function getOwnedQueueRecord(userId, clientRequestId) {
  if (!userId || !clientRequestId) return null;
  let request;
  await runTransaction(QUEUE_STORE, 'readonly', (store) => {
    request = requestResult(store.get(clientRequestId));
  });
  const record = await request;
  return isOwnedOfflineRecord(record, userId) ? record : null;
}

export async function removeOfflineExpense(userId, clientRequestId) {
  const record = await getOwnedQueueRecord(userId, clientRequestId);
  if (!record) return false;
  await runTransaction(QUEUE_STORE, 'readwrite', (store) => store.delete(clientRequestId));
  emit(OFFLINE_QUEUE_CHANGED, { userId, workspaceId: record.workspace_id });
  return true;
}

export async function retryOfflineExpense(userId, clientRequestId) {
  const record = await getOwnedQueueRecord(userId, clientRequestId);
  if (!record) return false;
  await updateQueueRecord({ ...record, state: 'pending', error: null }, userId);
  emit(OFFLINE_QUEUE_CHANGED, { userId, workspaceId: record.workspace_id });
  return true;
}

function isNetworkError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return typeof navigator !== 'undefined' && !navigator.onLine
    || message.includes('failed to fetch')
    || message.includes('networkerror')
    || message.includes('load failed');
}

export async function syncOfflineExpenses(supabase, userId, workspaceId) {
  if (!userId || !workspaceId || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    return { synced: 0, failed: 0 };
  }
  const records = (await listOfflineExpenses(userId, workspaceId)).filter((record) => record.state === 'pending');
  let synced = 0;
  let failed = 0;
  for (const record of records) {
    if (!isOwnedOfflineRecord(record, userId)) continue;
    await updateQueueRecord({ ...record, state: 'syncing', error: null }, userId);
    const { error } = await supabase.rpc('create_offline_expense', {
      p_client_request_id: record.client_request_id,
      ...record.payload,
    });
    if (!error) {
      await removeOfflineExpense(userId, record.client_request_id);
      synced += 1;
      continue;
    }
    const networkFailure = isNetworkError(error);
    await updateQueueRecord({
      ...record,
      state: networkFailure ? 'pending' : 'failed',
      error: networkFailure ? null : (error.message || 'Не удалось синхронизировать расход'),
    }, userId);
    if (!networkFailure) failed += 1;
    if (networkFailure) break;
  }
  emit(OFFLINE_QUEUE_CHANGED, { userId, workspaceId });
  if (synced) emit(OFFLINE_SYNC_COMPLETED, { userId, workspaceId, synced });
  return { synced, failed };
}

async function clearStoreForUser(storeName, userId) {
  if (!userId) return;
  await runTransaction(storeName, 'readwrite', (store) => {
    const request = store.index('user_id').openCursor(userId);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
  });
}

export async function clearOfflineDataForUser(userId) {
  if (!userId || typeof globalThis.indexedDB === 'undefined') return;
  await Promise.all([
    clearStoreForUser(QUEUE_STORE, userId),
    clearStoreForUser(REFERENCE_STORE, userId),
  ]);
  emit(OFFLINE_QUEUE_CHANGED, { userId });
}

export async function clearFinTrackCaches() {
  if (typeof globalThis.caches === 'undefined') return;
  const cacheNames = await globalThis.caches.keys();
  await Promise.all(cacheNames
    .filter((cacheName) => cacheName.startsWith(FINTRACK_CACHE_PREFIX))
    .map((cacheName) => globalThis.caches.delete(cacheName)));
}

export async function clearLocalFinancialData(userId) {
  await Promise.all([
    clearOfflineDataForUser(userId),
    clearFinTrackCaches(),
  ]);
}
