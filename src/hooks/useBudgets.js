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
      const monthEnd = new Date(`${month}T00:00:00`);
      monthEnd.setMonth(monthEnd.getMonth() + 1);
      const monthEndString = [
        monthEnd.getFullYear(),
        String(monthEnd.getMonth() + 1).padStart(2, '0'),
        String(monthEnd.getDate()).padStart(2, '0'),
      ].join('-');

      const [progressResult, operationsResult] = await Promise.all([
        supabase.rpc('get_budget_progress', {
          p_workspace_id: workspaceId,
          p_month: month
        }),
        supabase
          .from('operations')
          .select('category_id, base_amount, amount')
          .eq('workspace_id', workspaceId)
          .in('type', ['expense', 'salary'])
          .gte('operation_date', month)
          .lt('operation_date', monthEndString)
          .not('category_id', 'is', null),
      ]);

      if (progressResult.error) throw progressResult.error;
      if (operationsResult.error) throw operationsResult.error;

      const spentByCategory = new Map();
      (operationsResult.data || []).forEach((operation) => {
        const amount = Number(operation.base_amount ?? operation.amount) || 0;
        spentByCategory.set(
          operation.category_id,
          (spentByCategory.get(operation.category_id) || 0) + amount,
        );
      });

      const merged = new Map();
      (progressResult.data || []).forEach((budget) => {
        const amount = Number(budget.amount) || 0;
        const spent = spentByCategory.get(budget.category_id) ?? (Number(budget.spent) || 0);
        merged.set(budget.category_id, {
          ...budget,
          amount,
          spent,
          remaining: amount - spent,
          progress_pct: amount > 0 ? (spent / amount) * 100 : 0,
          has_limit: true,
        });
      });

      spentByCategory.forEach((spent, categoryId) => {
        if (merged.has(categoryId)) return;
        merged.set(categoryId, {
          id: null,
          category_id: categoryId,
          amount: 0,
          spent,
          remaining: null,
          progress_pct: 0,
          has_limit: false,
        });
      });

      setBudgets([...merged.values()]);
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
