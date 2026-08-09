import { useCallback, useEffect, useState } from 'react';
import { supabase, useAuth } from '../contexts/AuthContext';
import {
  listOfflineExpenses,
  OFFLINE_QUEUE_CHANGED,
  removeOfflineExpense,
  retryOfflineExpense,
  syncOfflineExpenses,
} from '../utils/offlineStore';

export function useOfflineQueue(workspaceId) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [items, setItems] = useState([]);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    setItems(await listOfflineExpenses(userId, workspaceId));
  }, [userId, workspaceId]);

  const sync = useCallback(async () => {
    if (!userId || !workspaceId || !navigator.onLine) return;
    setSyncing(true);
    try {
      await syncOfflineExpenses(supabase, userId, workspaceId);
      await refresh();
    } finally {
      setSyncing(false);
    }
  }, [refresh, userId, workspaceId]);

  useEffect(() => {
    const handleOnline = () => { setOnline(true); sync(); };
    const handleOffline = () => setOnline(false);
    const handleQueueChange = () => refresh();
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener(OFFLINE_QUEUE_CHANGED, handleQueueChange);
    refresh().then(() => { if (navigator.onLine) sync(); });
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener(OFFLINE_QUEUE_CHANGED, handleQueueChange);
    };
  }, [refresh, sync]);

  const retry = useCallback(async (id) => {
    await retryOfflineExpense(userId, id);
    await sync();
  }, [sync, userId]);

  const remove = useCallback(async (id) => {
    await removeOfflineExpense(userId, id);
    await refresh();
  }, [refresh, userId]);

  return { items, online, syncing, sync, retry, remove };
}

export default useOfflineQueue;
