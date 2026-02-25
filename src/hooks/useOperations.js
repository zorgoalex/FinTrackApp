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
        .select('id, workspace_id, user_id, amount, type, description, operation_date, created_at, category_id')
        .eq('workspace_id', workspaceId)
        .order('operation_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (loadError) {
        throw loadError;
      }

      // Fetch tags for all operations (two-query approach to avoid PostgREST join RLS issues)
      const opIds = (data || []).map((o) => o.id);
      let tagsByOpId = {};
      if (opIds.length > 0) {
        const { data: tagLinks, error: tagLinksErr } = await supabase
          .from('operation_tags')
          .select('operation_id, tag_id')
          .in('operation_id', opIds);

        if (tagLinksErr) {
          console.error('useOperations: operation_tags query failed:', tagLinksErr.message, tagLinksErr);
        }

        if (!tagLinksErr && tagLinks && tagLinks.length === 0 && opIds.length > 0) {
          console.warn(
            'useOperations: operation_tags returned 0 rows for', opIds.length, 'operations.',
            'This may indicate RLS on operation_tags is blocking SELECT.',
            'Check that operation_tags has a SELECT policy allowing workspace members to read.'
          );
        }

        if (tagLinks && tagLinks.length > 0) {
          const tagIds = [...new Set(tagLinks.map((l) => l.tag_id))];
          const { data: tagData, error: tagDataErr } = await supabase
            .from('tags')
            .select('id, name, color')
            .in('id', tagIds);

          if (tagDataErr) {
            console.error('useOperations: tags query failed:', tagDataErr.message, tagDataErr);
          }

          const tagMap = {};
          (tagData || []).forEach((t) => { tagMap[t.id] = t; });

          tagLinks.forEach((link) => {
            if (!tagsByOpId[link.operation_id]) tagsByOpId[link.operation_id] = [];
            const tag = tagMap[link.tag_id];
            if (tag) tagsByOpId[link.operation_id].push(tag);
          });
        }
      }

      const mappedOperations = (data || []).map((operation) => ({
        ...mapOperationWithDisplayName(operation, authUser),
        tags: tagsByOpId[operation.id] || []
      }));

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
      operation_date: data?.operation_date || new Date().toISOString().slice(0, 10),
      category_id: data?.category_id || null
    };

    const tagNames = data?.tagNames || [];

    try {
      setLoading(true);
      setError(null);

      const { data: insertedData, error: insertError } = await supabase
        .from('operations')
        .insert([payload])
        .select('id, workspace_id, user_id, amount, type, description, operation_date, created_at, category_id')
        .single();

      if (insertError) {
        throw insertError;
      }

      // Create tags and link them
      if (tagNames.length > 0 && insertedData?.id) {
        const tagIds = [];
        for (const tagName of tagNames) {
          const trimmed = tagName.trim();
          if (!trimmed) continue;
          const { data: tagRow, error: tagErr } = await supabase
            .from('tags')
            .upsert(
              { workspace_id: workspaceId, name: trimmed, color: '#6B7280' },
              { onConflict: 'workspace_id,name' }
            )
            .select('id')
            .single();
          if (tagErr) {
            console.error('useOperations: tag upsert error', tagErr, { workspaceId, name: trimmed });
          } else if (tagRow?.id) {
            tagIds.push(tagRow.id);
          }
        }
        if (tagIds.length > 0) {
          const { error: linkErr } = await supabase
            .from('operation_tags')
            .insert(tagIds.map((tagId) => ({ operation_id: insertedData.id, tag_id: tagId })));
          if (linkErr) console.error('useOperations: operation_tags insert error', linkErr);
        }
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

  const updateOperation = useCallback(async (id, data) => {
    if (!workspaceId) {
      setError('Рабочее пространство не выбрано');
      return false;
    }

    if (!id) {
      setError('Не указан id операции');
      return false;
    }

    const payload = {};
    if (data.amount !== undefined) payload.amount = Number(data.amount) || 0;
    if (data.description !== undefined) payload.description = data.description;
    if (data.operation_date !== undefined) payload.operation_date = data.operation_date;
    if (data.category_id !== undefined) payload.category_id = data.category_id || null;

    try {
      setLoading(true);
      setError(null);

      const { error: updateError } = await supabase
        .from('operations')
        .update(payload)
        .eq('id', id)
        .eq('workspace_id', workspaceId);

      if (updateError) {
        throw updateError;
      }

      // Update tags if provided
      if (data.tagNames !== undefined) {
        // Remove existing tag links
        const { error: delErr } = await supabase
          .from('operation_tags')
          .delete()
          .eq('operation_id', id);
        if (delErr) console.error('useOperations: operation_tags delete error', delErr);

        // Create new tag links
        if (data.tagNames.length > 0) {
          const tagIds = [];
          for (const tagName of data.tagNames) {
            const trimmed = tagName.trim();
            if (!trimmed) continue;
            const { data: tagRow, error: tagErr } = await supabase
              .from('tags')
              .upsert(
                { workspace_id: workspaceId, name: trimmed, color: '#6B7280' },
                { onConflict: 'workspace_id,name' }
              )
              .select('id')
              .single();
            if (tagErr) {
              console.error('useOperations: tag upsert error (update)', tagErr, { workspaceId, name: trimmed });
            } else if (tagRow?.id) {
              tagIds.push(tagRow.id);
            }
          }
          if (tagIds.length > 0) {
            const { error: linkErr } = await supabase
              .from('operation_tags')
              .insert(tagIds.map((tagId) => ({ operation_id: id, tag_id: tagId })));
            if (linkErr) console.error('useOperations: operation_tags insert error (update)', linkErr);
          }
        }
      }

      await loadOperations();
      return true;
    } catch (updateException) {
      console.error('useOperations: update error', updateException);
      setError(updateException.message || 'Ошибка обновления операции');
      return false;
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
    updateOperation,
    deleteOperation,
    refresh,
    summary
  };
}

export default useOperations;
