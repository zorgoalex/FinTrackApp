import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Save, Trash2 } from 'lucide-react';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { usePermissions } from '../hooks/usePermissions';
import useCategories from '../hooks/useCategories';
import useBudgets from '../hooks/useBudgets';
import MonthPicker from '../components/MonthPicker';
import { formatMoney } from '../utils/formatters';
import { getMonthRange } from '../utils/dateRange';

export default function BudgetsPage() {
  const [searchParams] = useSearchParams();
  const { workspaceId: contextWorkspaceId, currentWorkspace } = useWorkspace();
  const permissions = usePermissions();
  const workspaceId = searchParams.get('workspaceId') || contextWorkspaceId;
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const month = useMemo(
    () => getMonthRange(selectedMonth.year, selectedMonth.month).dateFrom,
    [selectedMonth]
  );
  const { categories } = useCategories(workspaceId);
  const { budgets, loading, error, saveBudget, deleteBudget } = useBudgets(workspaceId, month);
  const [drafts, setDrafts] = useState({});
  const [savingCategory, setSavingCategory] = useState('');
  const [actionError, setActionError] = useState('');
  const currency = currentWorkspace?.base_currency || 'KZT';
  const expenseCategories = categories.filter((category) => category.type === 'expense' && !category.is_archived);
  const budgetByCategory = new Map(budgets.map((budget) => [budget.category_id, budget]));
  const canManage = permissions.hasManagementRights;
  const totals = budgets.reduce((result, budget) => ({
    amount: result.amount + (budget.has_limit ? budget.amount : 0),
    spent: result.spent + budget.spent
  }), { amount: 0, spent: 0 });

  const handleSave = async (categoryId) => {
    const existing = budgetByCategory.get(categoryId);
    const value = drafts[categoryId] ?? (existing?.has_limit ? existing.amount : '');
    setSavingCategory(categoryId);
    setActionError('');
    try {
      await saveBudget(categoryId, value);
      setDrafts((current) => {
        const next = { ...current };
        delete next[categoryId];
        return next;
      });
    } catch (saveException) {
      setActionError(saveException.message || 'Не удалось сохранить лимит');
    } finally {
      setSavingCategory('');
    }
  };

  const handleDelete = async (budget) => {
    if (!window.confirm('Удалить лимит для этой категории?')) return;
    setActionError('');
    try {
      await deleteBudget(budget.id);
    } catch (deleteException) {
      setActionError(deleteException.message || 'Не удалось удалить лимит');
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Бюджеты</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">Месячные лимиты расходов по категориям</p>
        </div>
        <MonthPicker year={selectedMonth.year} month={selectedMonth.month} onChange={setSelectedMonth} />
      </div>

      {(error || actionError) && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {actionError || error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="card">
          <p className="text-xs text-gray-500 dark:text-gray-400">Запланировано</p>
          <p className="text-xl font-semibold">{formatMoney(totals.amount, currency)}</p>
        </div>
        <div className="card">
          <p className="text-xs text-gray-500 dark:text-gray-400">Потрачено</p>
          <p className={`text-xl font-semibold ${totals.spent > totals.amount && totals.amount > 0 ? 'text-red-600' : ''}`}>
            {formatMoney(totals.spent, currency)}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {expenseCategories.map((category) => {
          const budget = budgetByCategory.get(category.id);
          const hasLimit = Boolean(budget?.has_limit);
          const progress = hasLimit ? Math.max(0, budget.progress_pct) : 0;
          const exceeded = progress > 100;
          return (
            <div key={category.id} className="card">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: category.color }} />
                    <h2 className="font-medium text-gray-900 dark:text-gray-100">{category.name}</h2>
                  </div>
                  {budget && (hasLimit || budget.spent > 0) && (
                    <p className={`mt-1 text-sm ${exceeded ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`}>
                      {hasLimit
                        ? `${formatMoney(budget.spent, currency)} из ${formatMoney(budget.amount, currency)}`
                        : `Потрачено ${formatMoney(budget.spent, currency)} · лимит не задан`}
                      {exceeded ? ` — превышение ${formatMoney(Math.abs(budget.remaining), currency)}` : ''}
                    </p>
                  )}
                </div>
                {canManage && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      aria-label={`Лимит бюджета: ${category.name}`}
                      min="0.01"
                      step="0.01"
                      className="input-field w-36"
                      placeholder="Лимит"
                      value={drafts[category.id] ?? (hasLimit ? budget.amount : '')}
                      onChange={(event) => setDrafts((current) => ({ ...current, [category.id]: event.target.value }))}
                    />
                    <button type="button" onClick={() => handleSave(category.id)} disabled={savingCategory === category.id} className="btn-primary p-2" title="Сохранить" aria-label={`Сохранить лимит: ${category.name}`}>
                      <Save size={16} />
                    </button>
                    {hasLimit && (
                      <button type="button" onClick={() => handleDelete(budget)} className="p-2 text-red-600" title="Удалить лимит" aria-label={`Удалить лимит: ${category.name}`}>
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                )}
              </div>
              {hasLimit && (
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    className={`h-full rounded-full ${exceeded ? 'bg-red-500' : progress >= 80 ? 'bg-amber-500' : 'bg-green-500'}`}
                    style={{ width: `${Math.min(progress, 100)}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
        {!loading && expenseCategories.length === 0 && (
          <div className="card text-center text-sm text-gray-600 dark:text-gray-400">
            Сначала добавьте категории расходов в справочниках.
          </div>
        )}
        {loading && <div className="text-center text-sm text-gray-500">Загрузка бюджетов...</div>}
      </div>
    </div>
  );
}
