import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../contexts/AuthContext';

export default function useSavingsGoals(workspaceId) {
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadGoals = useCallback(async () => {
    if (!workspaceId) return setGoals([]);
    setLoading(true);
    const { data, error: loadError } = await supabase.rpc('get_savings_goal_progress', { p_workspace_id: workspaceId });
    if (loadError) setError(loadError.message);
    else setGoals((data || []).map((goal) => ({
      ...goal,
      target_amount: Number(goal.target_amount) || 0,
      saved_amount: Number(goal.saved_amount) || 0,
      remaining_amount: Number(goal.remaining_amount) || 0,
      progress_pct: Number(goal.progress_pct) || 0,
    })));
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { loadGoals(); }, [loadGoals]);

  const addGoal = async ({ name, targetAmount, targetDate, accountId }) => {
    const { data: userData } = await supabase.auth.getUser();
    const { error: saveError } = await supabase.from('savings_goals').insert({
      workspace_id: workspaceId,
      name: name.trim(),
      target_amount: Number(targetAmount),
      target_date: targetDate || null,
      account_id: accountId || null,
      created_by: userData?.user?.id || null,
    });
    if (saveError) throw saveError;
    await loadGoals();
  };

  const addContribution = async (goalId, amount, note = '') => {
    const { error: saveError } = await supabase.rpc('add_savings_goal_contribution', {
      p_goal_id: goalId,
      p_amount: Number(amount),
      p_note: note || null,
    });
    if (saveError) throw saveError;
    await loadGoals();
  };

  const transitionGoal = async (goalId, status) => {
    const { error: saveError } = await supabase.rpc('transition_savings_goal_status', { p_goal_id: goalId, p_status: status });
    if (saveError) throw saveError;
    await loadGoals();
  };

  return { goals, loading, error, addGoal, addContribution, transitionGoal, refresh: loadGoals };
}
