import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../contexts/AuthContext';
import { enqueueOfflineExpense, isOfflineExpenseType, OFFLINE_SYNC_COMPLETED } from '../utils/offlineStore';

const EMPTY_PERIOD_SUMMARY = {
  income: 0,
  expense: 0,
  salary: 0,
  total: 0
};

const ALLOWED_TYPES = ['income', 'expense', 'personal_salary', 'employee_salary', 'transfer'];

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

function buildAllocationsPayload(allocations, amount, baseAmount) {
  if (!Array.isArray(allocations) || allocations.length < 2) return [];
  const total = Number(amount);
  const baseTotal = Number(baseAmount);
  let allocatedBase = 0;
  return allocations.map((allocation, index) => {
    const allocationAmount = Math.round(Number(allocation.amount) * 100) / 100;
    const allocationBase = index === allocations.length - 1
      ? Math.round((baseTotal - allocatedBase) * 100) / 100
      : Math.round((allocationAmount / total) * baseTotal * 100) / 100;
    allocatedBase += allocationBase;
    return {
      category_id: allocation.category_id || null,
      counterparty_id: allocation.counterparty_id || null,
      amount: allocationAmount,
      base_amount: allocationBase,
    };
  });
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
    if (!['income', 'expense', 'personal_salary', 'employee_salary'].includes(type)) {
      return;
    }

    const amount = Math.abs(Number(operation?.base_amount ?? operation?.amount) || 0);
    const operationDate = toOperationDate(operation?.operation_date || operation?.created_at);
    if (!operationDate) {
      return;
    }

    if (operationDate >= startOfMonth && operationDate < endOfMonth) {
      if (type === 'personal_salary') summary.month.income += amount;
      else if (type === 'employee_salary') summary.month.salary += amount;
      else summary.month[type] += amount;
    }

    if (operationDate >= startOfToday && operationDate < endOfToday) {
      if (type === 'personal_salary') summary.today.income += amount;
      else if (type === 'employee_salary') summary.today.salary += amount;
      else summary.today[type] += amount;
    }
  });

  summary.today.total = summary.today.income - summary.today.expense - summary.today.salary;
  summary.month.total = summary.month.income - summary.month.expense - summary.month.salary;

  return summary;
}

async function getAuthUser() {
  const { data: sessionData } = await supabase.auth.getSession();
  return sessionData?.session?.user || null;
}

export function useOperations(workspaceId, options = {}) {
  const { dateFrom, dateTo, pageSize = 100 } = options;
  const [operations, setOperations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [visibleLimit, setVisibleLimit] = useState(pageSize);
  const [totalCount, setTotalCount] = useState(0);
  const [serverSummary, setServerSummary] = useState(null);
  const loadRequestRef = useRef(0);

  const loadSummary = useCallback(async () => {
    if (!workspaceId) {
      setServerSummary(null);
      return;
    }

    const now = new Date();
    const today = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
    const { data, error: summaryError } = await supabase.rpc(
      'get_workspace_operation_summary',
      { p_workspace_id: workspaceId, p_today: today }
    );
    if (summaryError) {
      console.error('useOperations: summary error', summaryError);
      setServerSummary(null);
      return;
    }

    const summary = {
      today: { ...EMPTY_PERIOD_SUMMARY },
      month: { ...EMPTY_PERIOD_SUMMARY },
    };
    (data || []).forEach((row) => {
      if (!summary[row.period]) return;
      summary[row.period] = {
        income: Number(row.income) || 0,
        expense: Number(row.expense) || 0,
        salary: Number(row.salary) || 0,
        total: Number(row.total) || 0,
      };
    });
    setServerSummary(summary);
  }, [workspaceId]);

  const loadOperations = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    if (!workspaceId) {
      setOperations([]);
      setError(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const [authUser, { data, error: loadError, count }] = await Promise.all([
        getAuthUser(),
        (async () => {
          let query = supabase
            .from('operations')
            .select('id, workspace_id, user_id, amount, type, description, operation_date, created_at, category_id, counterparty_id, account_id, transfer_group_id, transfer_direction, linked_operation_id, split_group_id, debt_id, debt_applied_amount, currency, exchange_rate, base_amount, import_session_id, import_fingerprint, import_confidence, status, verified_at, verified_by, reconciled_at, reconciled_by, operation_allocations(id, amount, base_amount, category_id, counterparty_id, position)', { count: 'exact' })
            .eq('workspace_id', workspaceId);
          if (dateFrom) query = query.gte('operation_date', dateFrom);
          if (dateTo) query = query.lte('operation_date', dateTo);
          return query
            .order('operation_date', { ascending: false })
            .order('created_at', { ascending: false })
            .range(0, visibleLimit - 1);
        })()
      ]);

      if (loadError) {
        throw loadError;
      }

      // Fetch tags for all operations (two-query approach to avoid PostgREST join RLS issues)
      const opIds = (data || []).map((o) => o.id);
      let tagsByOpId = {};
      const commentCountByOpId = {};
      if (opIds.length > 0) {
        const { data: tagLinks, error: tagLinksErr } = await supabase
          .from('operation_tags')
          .select('operation_id, tag_id')
          .in('operation_id', opIds);

        if (tagLinksErr) {
          console.error('useOperations: operation_tags query failed:', tagLinksErr.message, tagLinksErr);
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

        const { data: commentRows, error: commentsError } = await supabase
          .from('operation_comments')
          .select('operation_id')
          .in('operation_id', opIds);
        if (commentsError) {
          console.error('useOperations: operation_comments query failed:', commentsError.message, commentsError);
        }
        (commentRows || []).forEach((comment) => {
          commentCountByOpId[comment.operation_id] = (commentCountByOpId[comment.operation_id] || 0) + 1;
        });
      }

      const mappedOperations = (data || []).map((operation) => ({
        ...mapOperationWithDisplayName(operation, authUser),
        tags: tagsByOpId[operation.id] || [],
        comment_count: commentCountByOpId[operation.id] || 0,
      }));

      if (requestId !== loadRequestRef.current) return;
      setOperations(mappedOperations);
      setTotalCount(count ?? mappedOperations.length);
      await loadSummary();
    } catch (loadException) {
      if (requestId !== loadRequestRef.current) return;
      console.error('useOperations: load error', loadException);
      setOperations([]);
      setTotalCount(0);
      setError(loadException.message || 'Ошибка загрузки операций');
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [workspaceId, dateFrom, dateTo, visibleLimit, loadSummary]);

  const refresh = useCallback(async () => {
    await loadOperations();
  }, [loadOperations]);

  const loadMore = useCallback(() => {
    setVisibleLimit((current) => current + pageSize);
  }, [pageSize]);

  const addOperation = useCallback(async (data, { refreshAfter = true } = {}) => {
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

    if (typeof navigator !== 'undefined' && !navigator.onLine && !isOfflineExpenseType(type)) {
      const offlineError = new Error('Офлайн можно добавить только расход. Доходы и переводы требуют соединения.');
      setError(offlineError.message);
      throw offlineError;
    }

    // Handle transfer type separately via RPC
    if (type === 'transfer') {
      try {
        setLoading(true);
        setError(null);

        const isCrossCurrency = data.from_currency
          && data.to_currency
          && data.from_currency !== data.to_currency;
        const rpcName = isCrossCurrency ? 'create_transfer_v2' : 'create_transfer';
        const rpcParams = isCrossCurrency
          ? {
              p_workspace_id: workspaceId,
              p_user_id: userId,
              p_from_account_id: data.from_account_id,
              p_to_account_id: data.to_account_id,
              p_from_amount: Number(data.from_amount ?? data.amount) || 0,
              p_to_amount: Number(data.to_amount) || 0,
              p_from_currency: data.from_currency,
              p_to_currency: data.to_currency,
              p_exchange_rate: Number(data.exchange_rate) || 0,
              p_description: data?.description || null,
              p_operation_date: data?.operation_date || new Date().toISOString().slice(0, 10),
            }
          : {
              p_workspace_id: workspaceId,
              p_user_id: userId,
              p_from_account_id: data.from_account_id,
              p_to_account_id: data.to_account_id,
              p_amount: Number(data?.amount) || 0,
              p_description: data?.description || null,
              p_operation_date: data?.operation_date || new Date().toISOString().slice(0, 10),
            };

        const { data: transferResult, error: transferErr } = await supabase
          .rpc(rpcName, rpcParams);

        if (transferErr) throw transferErr;

        // Link tags to both transfer operations
        const transferTagNames = data?.tagNames || [];
        if (transferTagNames.length > 0 && transferResult?.[0]) {
          const { out_operation_id, in_operation_id } = transferResult[0];
          const tagIds = (await Promise.all(transferTagNames.map(async (tagName) => {
            const trimmed = tagName.trim();
            if (!trimmed) return null;
            const { data: existing } = await supabase
              .from('tags').select('id').eq('workspace_id', workspaceId).eq('name', trimmed).maybeSingle();
            if (existing?.id) return existing.id;
            const { data: inserted } = await supabase
              .from('tags').insert({ workspace_id: workspaceId, name: trimmed, color: '#6B7280' }).select('id').single();
            return inserted?.id || null;
          }))).filter(Boolean);
          if (tagIds.length > 0) {
            const links = [out_operation_id, in_operation_id]
              .filter(Boolean)
              .flatMap(opId => tagIds.map(tagId => ({ operation_id: opId, tag_id: tagId })));
            await supabase.from('operation_tags').insert(links);
          }
        }

        if (refreshAfter) await loadOperations();
        return transferResult?.[0] || { success: true };
      } catch (transferException) {
        console.error('useOperations: transfer error', transferException);
        setError(transferException.message || 'Ошибка создания перевода');
        throw transferException;
      } finally {
        setLoading(false);
      }
    }

    const tagNames = data?.tagNames || [];
    const amount = Number(data?.amount) || 0;
    const baseAmount = data?.base_amount ? Number(data.base_amount) : amount;

    const createParams = {
      p_workspace_id: workspaceId,
      p_amount: amount,
      p_type: type,
      p_description: data?.description || '',
      p_operation_date: data?.operation_date || new Date().toISOString().slice(0, 10),
      p_category_id: data?.category_id || null,
      p_counterparty_id: data?.counterparty_id || null,
      p_account_id: data?.account_id || null,
      p_currency: data?.currency || 'KZT',
      p_exchange_rate: data?.exchange_rate ? Number(data.exchange_rate) : 1,
      p_base_amount: baseAmount,
      p_debt_id: data?.debt_id || null,
      p_debt_applied_amount: data?.debt_applied_amount ? Number(data.debt_applied_amount) : null,
      p_allocations: buildAllocationsPayload(data?.allocations, amount, baseAmount),
      p_tag_names: tagNames,
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const queued = await enqueueOfflineExpense({ workspaceId, payload: createParams });
      setError(null);
      return {
        id: queued.client_request_id,
        ...data,
        workspace_id: workspaceId,
        user_id: userId,
        offline_pending: true,
      };
    }

    try {
      setLoading(true);
      setError(null);

      const { data: insertedData, error: insertError } = await supabase.rpc('create_operation_with_allocations', createParams);

      if (insertError) {
        throw insertError;
      }

      if (refreshAfter) await loadOperations();

      return mapOperationWithDisplayName(insertedData, authUser);
    } catch (insertException) {
      console.error('useOperations: add error', insertException);
      setError(insertException.message || 'Ошибка добавления операции');
      throw insertException;
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

    // Handle transfer update via RPC
    if (data._isTransfer && data._transferGroupId) {
      try {
        setLoading(true);
        setError(null);

        const { error: rpcErr } = await supabase.rpc('update_transfer', {
          p_workspace_id: workspaceId,
          p_transfer_group_id: data._transferGroupId,
          p_from_account_id: data.from_account_id || null,
          p_to_account_id: data.to_account_id || null,
          p_amount: data.amount !== undefined ? Number(data.amount) || 0 : null,
          p_description: data.description !== undefined ? data.description : null,
          p_operation_date: data.operation_date || null,
        });

        if (rpcErr) throw rpcErr;

        // Update tags on both transfer operations
        if (data.tagNames !== undefined) {
          const { data: transferOps } = await supabase
            .from('operations').select('id').eq('transfer_group_id', data._transferGroupId);
          const opIds = (transferOps || []).map(o => o.id);
          for (const opId of opIds) {
            await supabase.from('operation_tags').delete().eq('operation_id', opId);
          }
          if (data.tagNames.length > 0 && opIds.length > 0) {
            const tagIds = (await Promise.all(data.tagNames.map(async (tagName) => {
              const trimmed = tagName.trim();
              if (!trimmed) return null;
              const { data: existing } = await supabase
                .from('tags').select('id').eq('workspace_id', workspaceId).eq('name', trimmed).maybeSingle();
              if (existing?.id) return existing.id;
              const { data: inserted } = await supabase
                .from('tags').insert({ workspace_id: workspaceId, name: trimmed, color: '#6B7280' }).select('id').single();
              return inserted?.id || null;
            }))).filter(Boolean);
            if (tagIds.length > 0) {
              const links = opIds.flatMap(opId => tagIds.map(tagId => ({ operation_id: opId, tag_id: tagId })));
              await supabase.from('operation_tags').insert(links);
            }
          }
        }

        await loadOperations();
        return true;
      } catch (e) {
        console.error('useOperations: update transfer error', e);
        setError(e.message || 'Ошибка обновления перевода');
        return false;
      } finally {
        setLoading(false);
      }
    }

    try {
      setLoading(true);
      setError(null);

      const amount = Number(data.amount) || 0;
      const baseAmount = data.base_amount ? Number(data.base_amount) : amount;
      const { error: updateError } = await supabase.rpc('update_operation_with_allocations', {
        p_operation_id: id,
        p_amount: amount,
        p_type: data.type,
        p_description: data.description || '',
        p_operation_date: data.operation_date,
        p_category_id: data.category_id || null,
        p_counterparty_id: data.counterparty_id || null,
        p_account_id: data.account_id,
        p_currency: data.currency || 'KZT',
        p_exchange_rate: data.exchange_rate ? Number(data.exchange_rate) : 1,
        p_base_amount: baseAmount,
        p_debt_id: data.debt_id || null,
        p_debt_applied_amount: data.debt_applied_amount ? Number(data.debt_applied_amount) : null,
        p_allocations: buildAllocationsPayload(data.allocations, amount, baseAmount),
        p_tag_names: data.tagNames ?? null,
      });

      if (updateError) {
        throw updateError;
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

  const deleteOperation = useCallback(async (id, transferGroupId = null) => {
    if (!workspaceId) {
      setError('Рабочее пространство не выбрано');
      return false;
    }

    if (!id) {
      setError('Не указан id операции');
      return false;
    }

    // Optimistic: remove from list immediately
    const previousOperations = operations;
    if (transferGroupId) {
      setOperations(prev => prev.filter(op => op.transfer_group_id !== transferGroupId));
    } else {
      setOperations(prev => prev.filter(op => op.id !== id));
    }

    try {
      setError(null);

      if (transferGroupId) {
        // Delete both operations in the transfer pair
        const { error: deleteError } = await supabase
          .from('operations')
          .delete()
          .eq('transfer_group_id', transferGroupId)
          .eq('workspace_id', workspaceId);
        if (deleteError) throw deleteError;
      } else {
        const { error: deleteError } = await supabase
          .from('operations')
          .delete()
          .eq('id', id)
          .eq('workspace_id', workspaceId);
        if (deleteError) throw deleteError;
      }

      await loadSummary();
      return true;
    } catch (deleteException) {
      console.error('useOperations: delete error', deleteException);
      setOperations(previousOperations);
      setError(deleteException.message || 'Ошибка удаления операции');
      return false;
    }
  }, [workspaceId, operations, loadSummary]);

  const transitionOperationStatus = useCallback(async (id, targetStatus, reason = null) => {
    if (!workspaceId || !id) throw new Error('Операция не выбрана');

    const { data, error: transitionError } = await supabase.rpc('transition_operation_status', {
      p_operation_id: id,
      p_target_status: targetStatus,
      p_reason: reason || null,
    });
    if (transitionError) throw transitionError;

    const updated = Array.isArray(data) ? data[0] : data;
    setOperations((current) => current.map((operation) => operation.id === id
      ? { ...operation, ...updated }
      : operation));
    await loadSummary();
    return updated;
  }, [loadSummary, workspaceId]);

  const splitOperation = useCallback(async (id, parts) => {
    if (!workspaceId || !id) throw new Error('Операция не выбрана');
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error('Для разделения операции требуется соединение');
    }

    setLoading(true);
    setError(null);
    try {
      const { data, error: splitError } = await supabase.rpc('split_operation', {
        p_operation_id: id,
        p_parts: parts,
      });
      if (splitError) throw splitError;
      await loadOperations();
      return data || [];
    } catch (splitException) {
      console.error('useOperations: split error', splitException);
      setError(splitException.message || 'Ошибка разделения операции');
      throw splitException;
    } finally {
      setLoading(false);
    }
  }, [loadOperations, workspaceId]);

  useEffect(() => {
    setVisibleLimit(pageSize);
  }, [workspaceId, dateFrom, dateTo, pageSize]);

  useEffect(() => {
    loadOperations();
  }, [loadOperations]);

  useEffect(() => {
    const handleOfflineSync = (event) => {
      if (event.detail?.workspaceId === workspaceId) loadOperations();
    };
    window.addEventListener(OFFLINE_SYNC_COMPLETED, handleOfflineSync);
    return () => window.removeEventListener(OFFLINE_SYNC_COMPLETED, handleOfflineSync);
  }, [loadOperations, workspaceId]);

  const summary = useMemo(
    () => serverSummary || calculateSummary(operations),
    [serverSummary, operations]
  );

  return {
    operations,
    loading,
    error,
    addOperation,
    updateOperation,
    deleteOperation,
    transitionOperationStatus,
    splitOperation,
    refresh,
    summary,
    totalCount,
    hasMore: operations.length < totalCount,
    loadMore,
    loadingMore: loading && operations.length > 0,
  };
}

export default useOperations;
