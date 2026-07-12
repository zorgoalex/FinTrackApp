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
      const progressResult = await supabase.rpc('get_budget_progress', {
        p_workspace_id: workspaceId,
        p_month: month
      });

      if (progressResult.error) throw progressResult.error;

      const merged = new Map();
      (progressResult.data || []).forEach((budget) => {
        const amount = Number(budget.amount) || 0;
        const effectiveAmount = Number(budget.effective_amount ?? budget.amount) || 0;
        const spent = Number(budget.spent) || 0;
        merged.set(budget.category_id, {
          ...budget,
          amount,
          carry_cap: budget.carry_cap === null ? null : Number(budget.carry_cap),
          carryover_amount: Number(budget.carryover_amount) || 0,
          effective_amount: effectiveAmount,
          spent,
          remaining: effectiveAmount - spent,
          progress_pct: effectiveAmount > 0 ? (spent / effectiveAmount) * 100 : 0,
          has_limit: true,
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

  const saveBudget = async (categoryId, amount, options = {}) => {
    setError('');
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throw new Error('Лимит должен быть больше нуля');
    }
    const { error: saveError } = await supabase.rpc('ensure_budget_period', {
      p_workspace_id: workspaceId,
      p_category_id: categoryId,
      p_month: month,
      p_amount: numericAmount,
      p_rollover_mode: options.rollover_mode || 'none',
      p_carry_cap: options.carry_cap === '' || options.carry_cap === undefined ? null : Number(options.carry_cap),
    });
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

  const copyPreviousMonth = async () => {
    const current = new Date(`${month}T00:00:00`);
    current.setMonth(current.getMonth() - 1);
    const previousMonth = [
      current.getFullYear(),
      String(current.getMonth() + 1).padStart(2, '0'),
      '01',
    ].join('-');
    const { data: previousBudgets, error: previousError } = await supabase
      .from('budgets')
      .select('category_id, amount, rollover_mode, carry_cap')
      .eq('workspace_id', workspaceId)
      .eq('month', previousMonth);
    if (previousError) throw previousError;
    if (!previousBudgets?.length) return 0;
    for (const budget of previousBudgets) {
      const { error: copyError } = await supabase.rpc('ensure_budget_period', {
        p_workspace_id: workspaceId,
        p_category_id: budget.category_id,
        p_month: month,
        p_amount: Number(budget.amount),
        p_rollover_mode: budget.rollover_mode || 'none',
        p_carry_cap: budget.carry_cap,
      });
      if (copyError) throw copyError;
    }
    await loadBudgets();
    return previousBudgets.length;
  };

  return { budgets, loading, error, saveBudget, deleteBudget, copyPreviousMonth };
}
