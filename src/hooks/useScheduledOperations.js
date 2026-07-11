import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../contexts/AuthContext';

export function useScheduledOperations(workspaceId) {
  const [items, setItems] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!workspaceId) {
      setItems([]);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const [itemsResult, historyResult] = await Promise.all([
        supabase
          .from('scheduled_operations')
          .select('id, workspace_id, user_id, amount, type, description, category_id, account_id, frequency, next_date, is_active, created_at, currency, last_error, last_error_at')
          .eq('workspace_id', workspaceId)
          .order('next_date', { ascending: true }),
        supabase
          .from('operations')
          .select('id, scheduled_operation_id, scheduled_for_date, operation_date, amount, base_amount, currency, type, description, account_id, created_at')
          .eq('workspace_id', workspaceId)
          .not('scheduled_operation_id', 'is', null)
          .order('scheduled_for_date', { ascending: false })
          .limit(20),
      ]);
      if (itemsResult.error) throw itemsResult.error;
      setItems(itemsResult.data || []);
      if (historyResult.error) {
        console.error('useScheduledOperations: history load error', historyResult.error);
        setHistory([]);
      } else {
        setHistory(historyResult.data || []);
      }
    } catch (e) {
      console.error('useScheduledOperations: load error', e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  const add = useCallback(async (data) => {
    if (!workspaceId) return null;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Не авторизован'); return null; }
    try {
      setError(null);
      const { data: inserted, error: err } = await supabase
        .from('scheduled_operations')
        .insert([{
          workspace_id: workspaceId,
          user_id: user.id,
          amount: Number(data.amount) || 0,
          type: data.type,
          description: data.description || '',
          category_id: data.category_id || null,
          account_id: data.account_id,
          frequency: data.frequency,
          next_date: data.next_date,
          anchor_month: Number(data.next_date.slice(5, 7)),
          anchor_day: Number(data.next_date.slice(8, 10)),
          is_active: true,
        }])
        .select()
        .single();
      if (err) throw err;
      setItems(prev => [...prev, inserted].sort((a, b) => a.next_date.localeCompare(b.next_date)));
      return inserted;
    } catch (e) {
      setError(e.message);
      return null;
    }
  }, [workspaceId]);

  const update = useCallback(async (id, data) => {
    try {
      setError(null);
      const payload = {};
      if (data.amount !== undefined) payload.amount = Number(data.amount);
      if (data.description !== undefined) payload.description = data.description;
      if (data.category_id !== undefined) payload.category_id = data.category_id || null;
      if (data.account_id !== undefined) payload.account_id = data.account_id;
      if (data.frequency !== undefined) payload.frequency = data.frequency;
      if (data.next_date !== undefined) {
        payload.next_date = data.next_date;
        payload.anchor_month = Number(data.next_date.slice(5, 7));
        payload.anchor_day = Number(data.next_date.slice(8, 10));
      }
      if (data.is_active !== undefined) payload.is_active = data.is_active;
      const { error: err } = await supabase
        .from('scheduled_operations')
        .update(payload)
        .eq('id', id)
        .eq('workspace_id', workspaceId);
      if (err) throw err;
      await load();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  }, [workspaceId, load]);

  const remove = useCallback(async (id) => {
    const prev = items;
    setItems(old => old.filter(i => i.id !== id));
    try {
      setError(null);
      const { error: err } = await supabase
        .from('scheduled_operations')
        .delete()
        .eq('id', id)
        .eq('workspace_id', workspaceId);
      if (err) throw err;
      return true;
    } catch (e) {
      setItems(prev);
      setError(e.message);
      return false;
    }
  }, [workspaceId, items]);

  const toggle = useCallback(async (id, isActive) => {
    return update(id, { is_active: isActive });
  }, [update]);

  return { items, history, loading, error, add, update, remove, toggle, refresh: load };
}
