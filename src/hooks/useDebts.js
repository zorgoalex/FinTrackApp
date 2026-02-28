import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, useAuth } from '../contexts/AuthContext';

export function useDebts(workspaceId) {
  const [debts, setDebts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { user } = useAuth();

  const loadDebts = useCallback(async () => {
    if (!workspaceId) {
      setDebts([]);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const { data, error: rpcErr } = await supabase
        .rpc('get_debts_with_balance', { p_workspace_id: workspaceId });

      if (rpcErr) throw rpcErr;
      setDebts(data || []);
    } catch (e) {
      console.error('useDebts: load error', e);
      setError(e.message || 'Ошибка загрузки долгов');
      setDebts([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const activeDebts = useMemo(
    () => debts.filter(d => !d.is_archived && d.remaining_amount > 0),
    [debts]
  );

  const createDebt = useCallback(async ({ title, counterparty, direction, initial_amount, opened_on, due_on, notes }) => {
    if (!workspaceId || !user) return null;
    try {
      const { data, error: insertErr } = await supabase
        .from('debts')
        .insert([{
          workspace_id: workspaceId,
          created_by: user.id,
          title: title.trim(),
          counterparty: counterparty.trim(),
          direction,
          initial_amount: Number(initial_amount),
          opened_on: opened_on || new Date().toISOString().slice(0, 10),
          due_on: due_on || null,
          notes: notes || null,
        }])
        .select()
        .single();

      if (insertErr) throw insertErr;
      await loadDebts();
      return data;
    } catch (e) {
      console.error('useDebts: create error', e);
      setError(e.message || 'Ошибка создания долга');
      return null;
    }
  }, [workspaceId, user, loadDebts]);

  const updateDebt = useCallback(async (id, patch) => {
    if (!workspaceId) return null;
    try {
      const updates = {};
      if (patch.title !== undefined) updates.title = patch.title.trim();
      if (patch.counterparty !== undefined) updates.counterparty = patch.counterparty.trim();
      if (patch.initial_amount !== undefined) updates.initial_amount = Number(patch.initial_amount);
      if (patch.due_on !== undefined) updates.due_on = patch.due_on || null;
      if (patch.notes !== undefined) updates.notes = patch.notes || null;

      const { data, error: updateErr } = await supabase
        .from('debts')
        .update(updates)
        .eq('id', id)
        .eq('workspace_id', workspaceId)
        .select()
        .single();

      if (updateErr) throw updateErr;
      await loadDebts();
      return data;
    } catch (e) {
      console.error('useDebts: update error', e);
      setError(e.message || 'Ошибка обновления долга');
      return null;
    }
  }, [workspaceId, loadDebts]);

  const archiveDebt = useCallback(async (id) => {
    if (!workspaceId) return { error: 'Нет рабочего пространства' };
    try {
      const { error: err } = await supabase
        .from('debts')
        .update({ is_archived: true })
        .eq('id', id)
        .eq('workspace_id', workspaceId);
      if (err) throw err;
      await loadDebts();
      return { success: true };
    } catch (e) {
      console.error('useDebts: archive error', e);
      return { error: e.message || 'Ошибка архивации' };
    }
  }, [workspaceId, loadDebts]);

  const unarchiveDebt = useCallback(async (id) => {
    if (!workspaceId) return { error: 'Нет рабочего пространства' };
    try {
      const { error: err } = await supabase
        .from('debts')
        .update({ is_archived: false })
        .eq('id', id)
        .eq('workspace_id', workspaceId);
      if (err) throw err;
      await loadDebts();
      return { success: true };
    } catch (e) {
      console.error('useDebts: unarchive error', e);
      return { error: e.message || 'Ошибка разархивации' };
    }
  }, [workspaceId, loadDebts]);

  const deleteDebt = useCallback(async (id) => {
    if (!workspaceId) return { error: 'Нет рабочего пространства' };
    try {
      // Check if debt has linked operations
      const { count } = await supabase
        .from('operations')
        .select('id', { count: 'exact', head: true })
        .eq('debt_id', id)
        .eq('workspace_id', workspaceId);

      if (count > 0) {
        return { error: `Нельзя удалить: долг привязан к ${count} операции(ям)` };
      }

      const { error: deleteErr } = await supabase
        .from('debts')
        .delete()
        .eq('id', id)
        .eq('workspace_id', workspaceId);
      if (deleteErr) throw deleteErr;
      await loadDebts();
      return { success: true };
    } catch (e) {
      console.error('useDebts: delete error', e);
      return { error: e.message || 'Ошибка удаления' };
    }
  }, [workspaceId, loadDebts]);

  const getDebtHistory = useCallback(async (debtId) => {
    if (!workspaceId || !debtId) return [];
    try {
      const { data, error: err } = await supabase
        .from('operations')
        .select('id, amount, debt_applied_amount, type, description, operation_date, created_at')
        .eq('workspace_id', workspaceId)
        .eq('debt_id', debtId)
        .order('operation_date', { ascending: false });
      if (err) throw err;
      return data || [];
    } catch (e) {
      console.error('useDebts: history error', e);
      return [];
    }
  }, [workspaceId]);

  useEffect(() => {
    loadDebts();
  }, [loadDebts]);

  return {
    debts,
    activeDebts,
    loading,
    error,
    loadDebts,
    createDebt,
    updateDebt,
    archiveDebt,
    unarchiveDebt,
    deleteDebt,
    getDebtHistory,
    refresh: loadDebts,
  };
}

export default useDebts;
