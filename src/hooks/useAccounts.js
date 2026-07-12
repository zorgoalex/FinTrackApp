import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../contexts/AuthContext';
import { cacheReference, getCachedReference } from '../utils/offlineStore';

export function useAccounts(workspaceId) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadAccounts = useCallback(async () => {
    if (!workspaceId) {
      setAccounts([]);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const { data, error: loadErr } = await supabase
        .from('accounts')
        .select('id, workspace_id, name, color, currency, opening_balance, opening_date, is_default, is_archived, created_at, updated_at')
        .eq('workspace_id', workspaceId)
        .order('is_default', { ascending: false })
        .order('name', { ascending: true });

      if (loadErr) throw loadErr;
      setAccounts(data || []);
      await cacheReference('accounts', workspaceId, data || []);
    } catch (e) {
      console.error('useAccounts: load error', e);
      const cached = await getCachedReference('accounts', workspaceId).catch(() => null);
      if (cached) {
        setAccounts(cached);
        setError(null);
      } else {
        setError(e.message || 'Ошибка загрузки счетов');
        setAccounts([]);
      }
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const addAccount = useCallback(async ({ name, color, currency, opening_balance, opening_date }) => {
    if (!workspaceId) return null;
    try {
      const { data, error: insertErr } = await supabase
        .from('accounts')
        .insert([{
          workspace_id: workspaceId,
          name: name.trim(),
          color: color || '#6B7280',
          currency: currency || 'KZT',
          opening_balance: Number(opening_balance) || 0,
          opening_date: opening_date || new Date().toISOString().slice(0, 10),
        }])
        .select('id, workspace_id, name, color, currency, opening_balance, opening_date, is_default, is_archived, created_at, updated_at')
        .single();

      if (insertErr) throw insertErr;
      await loadAccounts();
      return data;
    } catch (e) {
      console.error('useAccounts: add error', e);
      setError(e.message || 'Ошибка добавления счёта');
      return null;
    }
  }, [workspaceId, loadAccounts]);

  const updateAccount = useCallback(async (id, { name, color, opening_balance, opening_date }) => {
    if (!workspaceId) return null;
    try {
      const updates = {};
      if (name !== undefined) updates.name = name.trim();
      if (color !== undefined) updates.color = color;
      if (opening_balance !== undefined) updates.opening_balance = Number(opening_balance) || 0;
      if (opening_date !== undefined) updates.opening_date = opening_date;

      const { data, error: updateErr } = await supabase
        .from('accounts')
        .update(updates)
        .eq('id', id)
        .eq('workspace_id', workspaceId)
        .select('id, workspace_id, name, color, currency, opening_balance, opening_date, is_default, is_archived, created_at, updated_at')
        .single();

      if (updateErr) throw updateErr;
      await loadAccounts();
      return data;
    } catch (e) {
      console.error('useAccounts: update error', e);
      setError(e.message || 'Ошибка обновления счёта');
      return null;
    }
  }, [workspaceId, loadAccounts]);

  const deleteAccount = useCallback(async (id) => {
    if (!workspaceId) return { error: 'Нет рабочего пространства' };
    try {
      const { count } = await supabase
        .from('operations')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', id)
        .eq('workspace_id', workspaceId);

      if (count > 0) {
        return { error: `Нельзя удалить: счёт используется в ${count} операции(ях)` };
      }

      const { error: deleteErr } = await supabase
        .from('accounts')
        .delete()
        .eq('id', id)
        .eq('workspace_id', workspaceId);

      if (deleteErr) throw deleteErr;
      await loadAccounts();
      return { success: true };
    } catch (e) {
      console.error('useAccounts: delete error', e);
      const msg = e.message || 'Ошибка удаления счёта';
      setError(msg);
      return { error: msg };
    }
  }, [workspaceId, loadAccounts]);

  const archiveAccount = useCallback(async (id) => {
    if (!workspaceId) return { error: 'Нет рабочего пространства' };
    try {
      const { error: updateErr } = await supabase
        .from('accounts')
        .update({ is_archived: true })
        .eq('id', id)
        .eq('workspace_id', workspaceId);

      if (updateErr) throw updateErr;
      await loadAccounts();
      return { success: true };
    } catch (e) {
      console.error('useAccounts: archive error', e);
      const msg = e.message || 'Ошибка архивации счёта';
      setError(msg);
      return { error: msg };
    }
  }, [workspaceId, loadAccounts]);

  const unarchiveAccount = useCallback(async (id) => {
    if (!workspaceId) return { error: 'Нет рабочего пространства' };
    try {
      const { error: updateErr } = await supabase
        .from('accounts')
        .update({ is_archived: false })
        .eq('id', id)
        .eq('workspace_id', workspaceId);

      if (updateErr) throw updateErr;
      await loadAccounts();
      return { success: true };
    } catch (e) {
      console.error('useAccounts: unarchive error', e);
      const msg = e.message || 'Ошибка разархивации счёта';
      setError(msg);
      return { error: msg };
    }
  }, [workspaceId, loadAccounts]);

  const loadBalances = useCallback(async () => {
    if (!workspaceId) return {};
    try {
      const { data, error: rpcErr } = await supabase
        .rpc('get_account_balances', { p_workspace_id: workspaceId });

      if (rpcErr) throw rpcErr;
      const map = {};
      (data || []).forEach(row => {
        map[row.account_id] = {
          balance: Number(row.balance),
          currency: row.currency || 'KZT',
          base_balance: Number(row.base_balance ?? row.balance),
        };
      });
      return map;
    } catch (e) {
      console.error('useAccounts: loadBalances error', e);
      return {};
    }
  }, [workspaceId]);

  const loadBalanceHistory = useCallback(async ({ dateFrom, dateTo, granularity = 'day', accountIds = null }) => {
    if (!workspaceId || !dateFrom || !dateTo) return [];
    const { data, error: rpcErr } = await supabase.rpc('get_account_balance_history', {
      p_workspace_id: workspaceId,
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_granularity: granularity,
      p_account_ids: accountIds,
    });
    if (rpcErr) throw rpcErr;
    return (data || []).map((row) => ({
      ...row,
      opening_balance: Number(row.opening_balance) || 0,
      change: Number(row.change) || 0,
      closing_balance: Number(row.closing_balance) || 0,
      opening_base_balance: Number(row.opening_base_balance) || 0,
      base_change: Number(row.base_change) || 0,
      closing_base_balance: Number(row.closing_base_balance) || 0,
    }));
  }, [workspaceId]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  return {
    accounts,
    loading,
    error,
    addAccount,
    updateAccount,
    deleteAccount,
    archiveAccount,
    unarchiveAccount,
    loadBalances,
    loadBalanceHistory,
    refresh: loadAccounts,
  };
}

export default useAccounts;
