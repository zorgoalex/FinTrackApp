import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../contexts/AuthContext';

const EMPTY_PERIOD_SUMMARY = {
  income: 0,
  expense: 0,
  salary: 0,
  total: 0
};

const EMPTY_SUMMARY = {
  today: { ...EMPTY_PERIOD_SUMMARY },
  month: { ...EMPTY_PERIOD_SUMMARY }
};

const ALLOWED_TYPES = ['income', 'expense', 'salary'];

function toOperationDate(value) {
  if (!value) return null;

  const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
  const parsedDate = dateOnlyPattern.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  return parsedDate;
}

function mapOperationWithDisplayName(operation, authUser) {
  if (!operation?.user_id) {
    return {
      ...operation,
      displayName: 'Удалённый пользователь'
    };
  }

  if (authUser?.id && operation.user_id === authUser.id) {
    return {
      ...operation,
      displayName: authUser.email || `Пользователь (${operation.user_id.slice(0, 8)})`
    };
  }

  return {
    ...operation,
    displayName: `Пользователь (${operation.user_id.slice(0, 8)})`
  };
}

function calculateSummary(operations) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const summary = {
    today: { ...EMPTY_PERIOD_SUMMARY },
    month: { ...EMPTY_PERIOD_SUMMARY }
  };

  operations.forEach((operation) => {
    const type = (operation?.type || '').toLowerCase();
    if (!ALLOWED_TYPES.includes(type)) {
      return;
    }

    const amount = Math.abs(Number(operation?.amount) || 0);
    const operationDate = toOperationDate(operation?.operation_date || operation?.created_at);
    if (!operationDate) {
      return;
    }

    if (operationDate >= startOfMonth && operationDate < endOfMonth) {
      summary.month[type] += amount;
    }

    if (operationDate >= startOfToday && operationDate < endOfToday) {
      summary.today[type] += amount;
    }
  });

  summary.today.total = summary.today.income - summary.today.expense - summary.today.salary;
  summary.month.total = summary.month.income - summary.month.expense - summary.month.salary;

  return summary;
}

async function getAuthUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    return null;
  }

  return data?.user || null;
}

export function useOperations(workspaceId) {
  const [operations, setOperations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);

  const loadOperations = useCallback(async () => {
    if (!workspaceId) {
      setOperations([]);
      setSummary(EMPTY_SUMMARY);
      setError(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const authUser = await getAuthUser();

      const { data, error: loadError } = await supabase
        .from('operations')
        .select('id, workspace_id, user_id, amount, type, description, operation_date, created_at')
        .eq('workspace_id', workspaceId)
        .order('operation_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (loadError) {
        throw loadError;
      }

      const mappedOperations = (data || []).map((operation) => (
        mapOperationWithDisplayName(operation, authUser)
      ));

      setOperations(mappedOperations);
    } catch (loadException) {
      console.error('useOperations: load error', loadException);
      setOperations([]);
      setSummary(EMPTY_SUMMARY);
      setError(loadException.message || 'Ошибка загрузки операций');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const refresh = useCallback(async () => {
    await loadOperations();
  }, [loadOperations]);

  const addOperation = useCallback(async (data) => {
    if (!workspaceId) {
      setError('Рабочее пространство не выбрано');
      return null;
    }

    const type = (data?.type || '').toLowerCase();
    if (!ALLOWED_TYPES.includes(type)) {
      setError('Некорректный тип операции');
      return null;
    }

    const authUser = await getAuthUser();
    const userId = authUser?.id || null;

    if (!userId) {
      setError('Пользователь не авторизован');
      return null;
    }

    const payload = {
      workspace_id: workspaceId,
      user_id: userId,
      amount: Number(data?.amount) || 0,
      type,
      description: data?.description || '',
      operation_date: data?.operation_date || new Date().toISOString().slice(0, 10)
    };

    try {
      setLoading(true);
      setError(null);

      const { data: insertedData, error: insertError } = await supabase
        .from('operations')
        .insert([payload])
        .select('id, workspace_id, user_id, amount, type, description, operation_date, created_at')
        .single();

      if (insertError) {
        throw insertError;
      }

      await loadOperations();

      return mapOperationWithDisplayName(insertedData, authUser);
    } catch (insertException) {
      console.error('useOperations: add error', insertException);
      setError(insertException.message || 'Ошибка добавления операции');
      return null;
    } finally {
      setLoading(false);
    }
  }, [loadOperations, workspaceId]);

  const deleteOperation = useCallback(async (id) => {
    if (!workspaceId) {
      setError('Рабочее пространство не выбрано');
      return false;
    }

    if (!id) {
      setError('Не указан id операции');
      return false;
    }

    try {
      setLoading(true);
      setError(null);

      const { error: deleteError } = await supabase
        .from('operations')
        .delete()
        .eq('id', id)
        .eq('workspace_id', workspaceId);

      if (deleteError) {
        throw deleteError;
      }

      await loadOperations();
      return true;
    } catch (deleteException) {
      console.error('useOperations: delete error', deleteException);
      setError(deleteException.message || 'Ошибка удаления операции');
      return false;
    } finally {
      setLoading(false);
    }
  }, [loadOperations, workspaceId]);

  useEffect(() => {
    loadOperations();
  }, [loadOperations]);

  useEffect(() => {
    setSummary(calculateSummary(operations));
  }, [operations]);

  return {
    operations,
    loading,
    error,
    addOperation,
    deleteOperation,
    refresh,
    summary
  };
}

export default useOperations;
