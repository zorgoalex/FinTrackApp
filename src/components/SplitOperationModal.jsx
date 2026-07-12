import { useEffect, useMemo, useState } from 'react';
import { Plus, Split, Trash2, X } from 'lucide-react';
import { supabase } from '../contexts/AuthContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { categoryTypeForOperation } from '../utils/operationTypes';
import { createInitialSplitParts, splitAmountNumber, splitPartsMatchTotal } from '../utils/operationSplit';

const EDIT_ROLES = new Set(['owner', 'admin', 'member']);

export default function SplitOperationModal({ operation, onClose, onSplit }) {
  const { allWorkspaces } = useWorkspace();
  const [parts, setParts] = useState(() => createInitialSplitParts(operation));
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [counterparties, setCounterparties] = useState([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const targetWorkspaces = useMemo(() => allWorkspaces.filter((workspace) => (
    EDIT_ROLES.has(String(workspace.userRole || '').toLowerCase())
  )), [allWorkspaces]);
  const workspaceIds = useMemo(() => targetWorkspaces.map((workspace) => workspace.id), [targetWorkspaces]);
  const total = splitAmountNumber(operation?.amount);
  const allocated = parts.reduce((sum, part) => sum + splitAmountNumber(part.amount), 0);
  const remainder = Math.round((total - allocated) * 100) / 100;
  const totalsMatch = splitPartsMatchTotal(parts, total);

  useEffect(() => {
    let active = true;
    if (workspaceIds.length === 0) {
      setLoadingOptions(false);
      return undefined;
    }

    setLoadingOptions(true);
    Promise.all([
      supabase.from('accounts').select('id, workspace_id, name, currency, is_archived').in('workspace_id', workspaceIds).eq('is_archived', false),
      supabase.from('categories').select('id, workspace_id, name, type, is_archived').in('workspace_id', workspaceIds).eq('is_archived', false),
      supabase.from('counterparties').select('id, workspace_id, display_name, is_archived').in('workspace_id', workspaceIds).eq('is_archived', false),
    ]).then((results) => {
      if (!active) return;
      const failed = results.find((result) => result.error);
      if (failed) {
        setError(failed.error.message || 'Не удалось загрузить справочники пространств');
        return;
      }
      setAccounts(results[0].data || []);
      setCategories(results[1].data || []);
      setCounterparties(results[2].data || []);
    }).finally(() => {
      if (active) setLoadingOptions(false);
    });

    return () => { active = false; };
  }, [workspaceIds]);

  const updatePart = (index, patch) => {
    setParts((current) => current.map((part, partIndex) => (
      partIndex === index ? { ...part, ...patch } : part
    )));
  };

  const changeWorkspace = (index, workspaceId) => {
    updatePart(index, {
      workspace_id: workspaceId,
      account_id: '',
      category_id: '',
      counterparty_id: '',
    });
  };

  const addPart = () => {
    setParts((current) => [...current, {
      key: globalThis.crypto.randomUUID(),
      workspace_id: operation.workspace_id,
      account_id: '',
      category_id: '',
      counterparty_id: '',
      amount: remainder > 0 ? remainder.toFixed(2) : '',
    }]);
  };

  const removePart = (index) => {
    if (parts.length <= 2) return;
    setParts((current) => current.filter((_, partIndex) => partIndex !== index));
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!totalsMatch) {
      setError('Сумма частей должна точно совпадать с суммой исходной операции');
      return;
    }
    if (parts.some((part) => !part.workspace_id || !part.account_id)) {
      setError('Для каждой части выберите пространство и счёт');
      return;
    }
    if (parts.some((part) => accounts.find((account) => account.id === part.account_id)?.currency !== operation.currency)) {
      setError(`Все счета должны быть в валюте исходной операции (${operation.currency})`);
      return;
    }

    try {
      setSaving(true);
      await onSplit(operation.id, parts.map((part) => ({
        workspace_id: part.workspace_id,
        account_id: part.account_id,
        category_id: part.category_id || null,
        counterparty_id: part.counterparty_id || null,
        amount: splitAmountNumber(part.amount),
      })));
      onClose();
    } catch (splitError) {
      setError(splitError.message || 'Не удалось разделить операцию');
    } finally {
      setSaving(false);
    }
  };

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="split-operation-title">
    <div className="max-h-[94vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl dark:bg-gray-900 sm:max-w-5xl sm:rounded-2xl">
      <div className="sticky top-0 z-10 flex items-start justify-between border-b border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <div>
          <h2 id="split-operation-title" className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white"><Split size={20} />Разделить операцию</h2>
          <p className="mt-1 text-sm text-gray-500">Каждая часть станет самостоятельной операцией и повлияет на баланс выбранного счёта.</p>
        </div>
        <button type="button" onClick={onClose} className="grid min-h-11 min-w-11 place-items-center rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Закрыть"><X size={20} /></button>
      </div>

      <form onSubmit={submit} className="space-y-4 p-4">
        <div className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
          Первая часть остаётся в исходном пространстве, но её счёт можно изменить. Остальные части можно перенести в другие доступные пространства. Валюта счетов должна совпадать с {operation.currency}. После разделения все части получат статус «Новая» и потребуют подтверждения.
        </div>
        {operation.operation_allocations?.length > 0 && <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">Текущее распределение по категориям будет заменено самостоятельными операциями.</div>}

        {loadingOptions ? <p className="py-6 text-center text-sm text-gray-500">Загрузка счетов и справочников…</p> : parts.map((part, index) => {
          const workspaceAccounts = accounts.filter((account) => account.workspace_id === part.workspace_id && account.currency === operation.currency);
          const workspaceCategories = categories.filter((category) => category.workspace_id === part.workspace_id && category.type === categoryTypeForOperation(operation.type));
          const workspaceCounterparties = counterparties.filter((counterparty) => counterparty.workspace_id === part.workspace_id);
          return <div key={part.key} className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
            <div className="mb-2 flex items-center justify-between"><span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Часть {index + 1}</span>{index > 0 && parts.length > 2 && <button type="button" onClick={() => removePart(index)} className="grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30" aria-label={`Удалить часть ${index + 1}`}><Trash2 size={17} /></button>}</div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <label className="text-xs text-gray-500">Сумма<input className="input-field mt-1" type="number" min="0.01" step="0.01" value={part.amount} onChange={(event) => updatePart(index, { amount: event.target.value })} required /></label>
              <label className="text-xs text-gray-500">Пространство<select className="input-field mt-1" value={part.workspace_id} onChange={(event) => changeWorkspace(index, event.target.value)} disabled={index === 0}>{targetWorkspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
              <label className="text-xs text-gray-500">Счёт<select className="input-field mt-1" value={part.account_id} onChange={(event) => updatePart(index, { account_id: event.target.value })} required><option value="">Выберите счёт</option>{workspaceAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label>
              <label className="text-xs text-gray-500">Категория<select className="input-field mt-1" value={part.category_id || ''} onChange={(event) => updatePart(index, { category_id: event.target.value })}><option value="">Без категории</option>{workspaceCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
              <label className="text-xs text-gray-500">Контрагент<select className="input-field mt-1" value={part.counterparty_id || ''} onChange={(event) => updatePart(index, { counterparty_id: event.target.value })}><option value="">Без контрагента</option>{workspaceCounterparties.map((counterparty) => <option key={counterparty.id} value={counterparty.id}>{counterparty.display_name}</option>)}</select></label>
            </div>
            {workspaceAccounts.length === 0 && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">В этом пространстве нет активных счетов в валюте {operation.currency}.</p>}
          </div>;
        })}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={addPart} className="flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium text-primary-700 hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-950/30"><Plus size={17} />Добавить часть</button>
          <span className={`text-sm font-semibold tabular-nums ${totalsMatch ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>{totalsMatch ? `Итого ${total.toLocaleString('ru-RU')} ${operation.currency}` : `Осталось распределить ${remainder.toLocaleString('ru-RU')} ${operation.currency}`}</span>
        </div>
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300" role="alert">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
          <button type="button" onClick={onClose} className="btn-secondary min-h-11" disabled={saving}>Отмена</button>
          <button type="submit" className="btn-primary min-h-11" disabled={saving || loadingOptions || !totalsMatch}>{saving ? 'Разделение…' : 'Разделить операцию'}</button>
        </div>
      </form>
    </div>
  </div>;
}
