import { useCallback, useEffect, useState } from 'react';
import { supabase, useAuth } from '../contexts/AuthContext';

const numericReport = (row) => row ? {
  ...row,
  cash: Number(row.cash) || 0,
  manual_assets: Number(row.manual_assets) || 0,
  receivables: Number(row.receivables) || 0,
  total_assets: Number(row.total_assets) || 0,
  manual_liabilities: Number(row.manual_liabilities) || 0,
  payables: Number(row.payables) || 0,
  total_liabilities: Number(row.total_liabilities) || 0,
  net_worth: Number(row.net_worth) || 0,
} : null;

export default function useNetWorth(workspaceId) {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [goals, setGoals] = useState([]);
  const [report, setReport] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!workspaceId) {
      setItems([]); setGoals([]); setReport(null); setHistory([]);
      return;
    }
    setLoading(true);
    setError(null);
    const today = new Date().toISOString().slice(0, 10);
    const historyFrom = new Date();
    historyFrom.setMonth(historyFrom.getMonth() - 11);
    const from = historyFrom.toISOString().slice(0, 10);
    const [itemsResult, goalsResult, reportResult, historyResult] = await Promise.all([
      supabase.from('net_worth_items').select('*').eq('workspace_id', workspaceId).order('kind').order('name'),
      supabase.from('net_worth_goals').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }),
      supabase.rpc('get_net_worth_report', { p_workspace_id: workspaceId, p_as_of: today }).maybeSingle(),
      supabase.rpc('get_net_worth_history', { p_workspace_id: workspaceId, p_date_from: from, p_date_to: today, p_granularity: 'month' }),
    ]);
    const firstError = itemsResult.error || goalsResult.error || reportResult.error || historyResult.error;
    if (firstError) setError(firstError.message || 'Не удалось загрузить капитал');
    setItems((itemsResult.data || []).map((item) => ({
      ...item,
      current_value: Number(item.current_value) || 0,
      exchange_rate: Number(item.exchange_rate) || 1,
      current_base_value: Number(item.current_base_value) || 0,
    })));
    setGoals((goalsResult.data || []).map((goal) => ({ ...goal, target_amount: Number(goal.target_amount) || 0 })));
    setReport(numericReport(reportResult.data));
    setHistory((historyResult.data || []).map((row) => ({
      ...row,
      net_worth: Number(row.net_worth) || 0,
      total_assets: Number(row.total_assets) || 0,
      total_liabilities: Number(row.total_liabilities) || 0,
    })));
    setLoading(false);
  }, [workspaceId]);

  const saveItem = useCallback(async (item) => {
    if (!workspaceId || !user?.id) return null;
    const value = Number(item.current_value);
    const rate = Number(item.exchange_rate) || 1;
    const payload = {
      workspace_id: workspaceId,
      kind: item.kind,
      category: item.category,
      name: item.name.trim(),
      description: item.description?.trim() || null,
      currency: item.currency,
      current_value: value,
      exchange_rate: rate,
      current_base_value: Math.round(value * rate * 100) / 100,
      valued_on: item.valued_on,
      is_archived: Boolean(item.is_archived),
    };
    const query = item.id
      ? supabase.from('net_worth_items').update(payload).eq('id', item.id).eq('workspace_id', workspaceId)
      : supabase.from('net_worth_items').insert({ ...payload, created_by: user.id });
    const { data, error: saveError } = await query.select().single();
    if (saveError) { setError(saveError.message); return null; }
    await load();
    return data;
  }, [workspaceId, user?.id, load]);

  const archiveItem = useCallback(async (id, isArchived = true) => {
    const { error: archiveError } = await supabase.from('net_worth_items')
      .update({ is_archived: isArchived }).eq('id', id).eq('workspace_id', workspaceId);
    if (archiveError) { setError(archiveError.message); return false; }
    await load();
    return true;
  }, [workspaceId, load]);

  const saveGoal = useCallback(async ({ id, name, target_amount, target_date, status = 'active' }) => {
    if (!workspaceId || !user?.id) return null;
    const payload = { workspace_id: workspaceId, name: name.trim(), target_amount: Number(target_amount), target_date: target_date || null, status };
    const query = id
      ? supabase.from('net_worth_goals').update(payload).eq('id', id).eq('workspace_id', workspaceId)
      : supabase.from('net_worth_goals').insert({ ...payload, created_by: user.id });
    const { data, error: goalError } = await query.select().single();
    if (goalError) { setError(goalError.message); return null; }
    await load();
    return data;
  }, [workspaceId, user?.id, load]);

  useEffect(() => { load(); }, [load]);

  return { items, goals, report, history, loading, error, saveItem, archiveItem, saveGoal, refresh: load };
}
