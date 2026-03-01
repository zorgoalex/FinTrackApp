import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../contexts/AuthContext';

export function useScheduledOperations(workspaceId) {
  const [items, setItems] = useState([]);
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
      const { data, error: err } = await supabase
        .from('scheduled_operations')
        .select('id, workspace_id, user_id, amount, type, description, category_id, frequency, next_date, is_active, created_at, currency')
        .eq('workspace_id', workspaceId)
        .order('next_date', { ascending: true });
      if (err) throw err;
      setItems(data || []);
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
          frequency: data.frequency,
          next_date: data.next_date,
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
      if (data.frequency !== undefined) payload.frequency = data.frequency;
      if (data.next_date !== undefined) payload.next_date = data.next_date;
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

  return { items, loading, error, add, update, remove, toggle, refresh: load };
}
