const DATABASE_NAME = 'fintrack-offline';
const DATABASE_VERSION = 1;
const QUEUE_STORE = 'operation-queue';
const REFERENCE_STORE = 'reference-cache';

export const OFFLINE_QUEUE_CHANGED = 'fintrack:offline-queue-changed';
export const OFFLINE_SYNC_COMPLETED = 'fintrack:offline-sync-completed';

export function isOfflineExpenseType(type) {
  return type === 'expense' || type === 'employee_salary';
}

function openDatabase() {
  if (typeof globalThis.indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB недоступна'));
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error || new Error('Не удалось открыть offline-хранилище'));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(QUEUE_STORE)) {
        const queue = database.createObjectStore(QUEUE_STORE, { keyPath: 'client_request_id' });
        queue.createIndex('workspace_id', 'workspace_id', { unique: false });
        queue.createIndex('state', 'state', { unique: false });
      }
      if (!database.objectStoreNames.contains(REFERENCE_STORE)) {
        database.createObjectStore(REFERENCE_STORE, { keyPath: 'key' });
      }
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
    result = action(store);
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

export async function cacheReference(kind, id, value) {
  if (!id || value == null) return;
  await runTransaction(REFERENCE_STORE, 'readwrite', (store) => {
    store.put({ key: `${kind}:${id}`, value, updated_at: new Date().toISOString() });
  });
}

export async function getCachedReference(kind, id) {
  if (!id) return null;
  let request;
  await runTransaction(REFERENCE_STORE, 'readonly', (store) => {
    request = requestResult(store.get(`${kind}:${id}`));
  });
  return (await request)?.value ?? null;
}

export async function enqueueOfflineExpense({ workspaceId, payload }) {
  if (!workspaceId || !payload || !isOfflineExpenseType(payload.p_type)) {
    throw new Error('Офлайн можно добавить только расход');
  }
  const clientRequestId = globalThis.crypto.randomUUID();
  const record = {
    client_request_id: clientRequestId,
    workspace_id: workspaceId,
    payload,
    state: 'pending',
    error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await runTransaction(QUEUE_STORE, 'readwrite', (store) => store.add(record));
  emit(OFFLINE_QUEUE_CHANGED, { workspaceId });
  return record;
}

export async function listOfflineExpenses(workspaceId) {
  if (!workspaceId) return [];
  let request;
  await runTransaction(QUEUE_STORE, 'readonly', (store) => {
    request = requestResult(store.index('workspace_id').getAll(workspaceId));
  });
  return (await request || []).sort((left, right) => left.created_at.localeCompare(right.created_at));
}

async function updateQueueRecord(record) {
  await runTransaction(QUEUE_STORE, 'readwrite', (store) => store.put({
    ...record,
    updated_at: new Date().toISOString(),
  }));
}

export async function removeOfflineExpense(clientRequestId) {
  await runTransaction(QUEUE_STORE, 'readwrite', (store) => store.delete(clientRequestId));
  emit(OFFLINE_QUEUE_CHANGED, {});
}

export async function retryOfflineExpense(clientRequestId) {
  let request;
  await runTransaction(QUEUE_STORE, 'readonly', (store) => {
    request = requestResult(store.get(clientRequestId));
  });
  const record = await request;
  if (!record) return;
  await updateQueueRecord({ ...record, state: 'pending', error: null });
  emit(OFFLINE_QUEUE_CHANGED, { workspaceId: record.workspace_id });
}

function isNetworkError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return typeof navigator !== 'undefined' && !navigator.onLine
    || message.includes('failed to fetch')
    || message.includes('networkerror')
    || message.includes('load failed');
}

export async function syncOfflineExpenses(supabase, workspaceId) {
  if (!workspaceId || (typeof navigator !== 'undefined' && !navigator.onLine)) return { synced: 0, failed: 0 };
  const records = (await listOfflineExpenses(workspaceId)).filter((record) => record.state === 'pending');
  let synced = 0;
  let failed = 0;
  for (const record of records) {
    await updateQueueRecord({ ...record, state: 'syncing', error: null });
    const { error } = await supabase.rpc('create_offline_expense', {
      p_client_request_id: record.client_request_id,
      ...record.payload,
    });
    if (!error) {
      await removeOfflineExpense(record.client_request_id);
      synced += 1;
      continue;
    }
    const networkFailure = isNetworkError(error);
    await updateQueueRecord({
      ...record,
      state: networkFailure ? 'pending' : 'failed',
      error: networkFailure ? null : (error.message || 'Не удалось синхронизировать расход'),
    });
    if (!networkFailure) failed += 1;
    if (networkFailure) break;
  }
  emit(OFFLINE_QUEUE_CHANGED, { workspaceId });
  if (synced) emit(OFFLINE_SYNC_COMPLETED, { workspaceId, synced });
  return { synced, failed };
}
