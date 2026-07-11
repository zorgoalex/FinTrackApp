import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../contexts/AuthContext';

export default function useBudgets(workspaceId, month) {
  const [budgets, setBudgets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadBudgets = useCallback(async () => {
    if (!workspaceId || !month) {
      setBudgets([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data, error: loadError } = await supabase.rpc('get_budget_progress', {
        p_workspace_id: workspaceId,
        p_month: month
      });
      if (loadError) throw loadError;
      setBudgets((data || []).map((budget) => ({
        ...budget,
        amount: Number(budget.amount) || 0,
        spent: Number(budget.spent) || 0,
        remaining: Number(budget.remaining) || 0,
        progress_pct: Number(budget.progress_pct) || 0
      })));
    } catch (loadException) {
      console.error('useBudgets: load error', loadException);
      setError(loadException.message || 'Не удалось загрузить бюджеты');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, month]);

  useEffect(() => {
    loadBudgets();
  }, [loadBudgets]);

  const saveBudget = async (categoryId, amount) => {
    setError('');
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throw new Error('Лимит должен быть больше нуля');
    }
    const { data: userData } = await supabase.auth.getUser();
    const { error: saveError } = await supabase.from('budgets').upsert({
      workspace_id: workspaceId,
      category_id: categoryId,
      month,
      amount: numericAmount,
      created_by: userData?.user?.id || null
    }, { onConflict: 'workspace_id,category_id,month' });
    if (saveError) throw saveError;
    await loadBudgets();
  };

  const deleteBudget = async (budgetId) => {
    const { error: deleteError } = await supabase
      .from('budgets')
      .delete()
      .eq('id', budgetId)
      .eq('workspace_id', workspaceId);
    if (deleteError) throw deleteError;
    await loadBudgets();
  };

  return { budgets, loading, error, saveBudget, deleteBudget };
}
