import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Copy, Pause, Play, Plus, Save, Target, Trash2 } from 'lucide-react';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { usePermissions } from '../hooks/usePermissions';
import useCategories from '../hooks/useCategories';
import useBudgets from '../hooks/useBudgets';
import useSavingsGoals from '../hooks/useSavingsGoals';
import useAccounts from '../hooks/useAccounts';
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
  const { budgets, loading, error, saveBudget, deleteBudget, copyPreviousMonth } = useBudgets(workspaceId, month);
  const [drafts, setDrafts] = useState({});
  const [rolloverDrafts, setRolloverDrafts] = useState({});
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
  const now = new Date();
  const selectedDate = new Date(selectedMonth.year, selectedMonth.month, 1);
  const isCurrentMonth = selectedDate.getFullYear() === now.getFullYear() && selectedDate.getMonth() === now.getMonth();
  const daysInMonth = new Date(selectedMonth.year, selectedMonth.month + 1, 0).getDate();
  const elapsedDays = isCurrentMonth ? now.getDate() : daysInMonth;
  const forecast = elapsedDays > 0 ? (totals.spent / elapsedDays) * daysInMonth : totals.spent;
  const sortedExpenseCategories = [...expenseCategories].sort((left, right) => {
    const leftBudget = budgetByCategory.get(left.id);
    const rightBudget = budgetByCategory.get(right.id);
    if (Boolean(leftBudget?.has_limit) !== Boolean(rightBudget?.has_limit)) {
      return leftBudget?.has_limit ? -1 : 1;
    }
    return (rightBudget?.spent || 0) - (leftBudget?.spent || 0) || left.name.localeCompare(right.name, 'ru');
  });
  const dirtyCategoryIds = Object.keys(drafts).filter((categoryId) => {
    const value = Number(drafts[categoryId]);
    return Number.isFinite(value) && value > 0;
  });

  const handleSave = async (categoryId) => {
    const existing = budgetByCategory.get(categoryId);
    const value = drafts[categoryId] ?? (existing?.has_limit ? existing.amount : '');
    setSavingCategory(categoryId);
    setActionError('');
    try {
      await saveBudget(categoryId, value, rolloverDrafts[categoryId] || {
        rollover_mode: existing?.rollover_mode || 'none',
        carry_cap: existing?.carry_cap ?? '',
      });
      setDrafts((current) => {
        const next = { ...current };
        delete next[categoryId];
        return next;
      });
      setRolloverDrafts((current) => {
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

  const handleSaveAll = async () => {
    setActionError('');
    try {
      for (const categoryId of dirtyCategoryIds) {
        const existing = budgetByCategory.get(categoryId);
        await saveBudget(categoryId, drafts[categoryId], rolloverDrafts[categoryId] || {
          rollover_mode: existing?.rollover_mode || 'none',
          carry_cap: existing?.carry_cap ?? '',
        });
      }
      setDrafts({});
    } catch (saveException) {
      setActionError(saveException.message || 'Не удалось сохранить лимиты');
    }
  };

  const handleCopyPrevious = async () => {
    setActionError('');
    setSavingCategory('copy');
    try {
      const count = await copyPreviousMonth();
      if (!count) setActionError('В предыдущем месяце нет лимитов для копирования');
    } catch (copyException) {
      setActionError(copyException.message || 'Не удалось скопировать лимиты');
    } finally {
      setSavingCategory('');
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Бюджеты</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">Месячные лимиты расходов по категориям</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && (
            <button type="button" onClick={handleCopyPrevious} disabled={savingCategory === 'copy'} className="btn-secondary min-h-11">
              <Copy size={16} className="mr-2" />
              <span className="hidden sm:inline">Из прошлого месяца</span>
              <span className="sm:hidden">Копировать</span>
            </button>
          )}
          <MonthPicker year={selectedMonth.year} month={selectedMonth.month} onChange={setSelectedMonth} />
        </div>
      </div>

      {totals.amount > 0 && (
        <div className={`mb-6 rounded-xl border p-4 ${forecast > totals.amount ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20' : 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20'}`}>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Прогноз к концу месяца: {formatMoney(forecast, currency)}</p>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            По среднему темпу за {elapsedDays} {elapsedDays === 1 ? 'день' : 'дней'}.
            {forecast > totals.amount ? ` Возможное превышение: ${formatMoney(forecast - totals.amount, currency)}.` : ' Вы укладываетесь в общий лимит.'}
          </p>
        </div>
      )}

      {(error || actionError) && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {actionError || error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-6 sm:grid-cols-3">
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
        {totals.amount > 0 && (
          <div className="card col-span-2 sm:col-span-1">
            <p className="text-xs text-gray-500 dark:text-gray-400">Осталось</p>
            <p className={`text-xl font-semibold ${totals.amount - totals.spent < 0 ? 'text-red-600' : 'text-green-600'}`}>
              {formatMoney(Math.abs(totals.amount - totals.spent), currency)}
            </p>
          </div>
        )}
      </div>

      {canManage && dirtyCategoryIds.length > 0 && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-primary-200 bg-primary-50 p-3 dark:border-primary-800 dark:bg-primary-900/20">
          <span className="text-sm text-primary-800 dark:text-primary-300">Изменено лимитов: {dirtyCategoryIds.length}</span>
          <button type="button" onClick={handleSaveAll} className="btn-primary min-h-11">Сохранить все</button>
        </div>
      )}

      <div className="space-y-3">
        {sortedExpenseCategories.map((category) => {
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
                  {hasLimit && budget.carryover_amount !== 0 && (
                    <p className="mt-1 text-xs text-primary-600 dark:text-primary-400">
                      Перенос: {formatMoney(budget.carryover_amount, currency)} · доступно {formatMoney(budget.effective_amount, currency)}
                    </p>
                  )}
                </div>
                {canManage && (
                  <div className="flex w-full items-center gap-2 sm:w-auto">
                    <input
                      type="number"
                      aria-label={`Лимит бюджета: ${category.name}`}
                      min="0.01"
                      step="0.01"
                      className="input-field min-h-11 min-w-0 flex-1 sm:w-36 sm:flex-none"
                      placeholder="Лимит"
                      value={drafts[category.id] ?? (hasLimit ? budget.amount : '')}
                      onChange={(event) => setDrafts((current) => ({ ...current, [category.id]: event.target.value }))}
                    />
                    {!hasLimit && budget?.spent > 0 && drafts[category.id] === undefined && (
                      <button
                        type="button"
                        onClick={() => setDrafts((current) => ({ ...current, [category.id]: String(Math.ceil(budget.spent / 100) * 100) }))}
                        className="min-h-11 shrink-0 rounded-lg border border-gray-300 px-2 text-xs text-gray-600 dark:border-gray-600 dark:text-gray-300"
                      >
                        По факту
                      </button>
                    )}
                    <button type="button" onClick={() => handleSave(category.id)} disabled={savingCategory === category.id} className="btn-primary min-h-11 min-w-11 p-2" title="Сохранить" aria-label={`Сохранить лимит: ${category.name}`}>
                      <Save size={16} />
                    </button>
                    {hasLimit && (
                      <button type="button" onClick={() => handleDelete(budget)} className="min-h-11 min-w-11 p-2 text-red-600" title="Удалить лимит" aria-label={`Удалить лимит: ${category.name}`}>
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                )}
              </div>
              {canManage && (
                <div className="mt-3 grid gap-2 border-t border-gray-100 pt-3 dark:border-gray-700 sm:grid-cols-2">
                  <label className="text-xs text-gray-500 dark:text-gray-400">
                    Перенос на следующий месяц
                    <select
                      className="input-field mt-1 min-h-11 w-full"
                      value={rolloverDrafts[category.id]?.rollover_mode ?? budget?.rollover_mode ?? 'none'}
                      onChange={(event) => setRolloverDrafts((current) => ({
                        ...current,
                        [category.id]: { ...current[category.id], rollover_mode: event.target.value, carry_cap: current[category.id]?.carry_cap ?? budget?.carry_cap ?? '' },
                      }))}
                    >
                      <option value="none">Не переносить</option>
                      <option value="unused">Только неиспользованный остаток</option>
                      <option value="full">Весь лимит</option>
                    </select>
                  </label>
                  <label className="text-xs text-gray-500 dark:text-gray-400">
                    Максимум переноса (необязательно)
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="input-field mt-1 min-h-11 w-full"
                      placeholder="Без ограничения"
                      value={rolloverDrafts[category.id]?.carry_cap ?? budget?.carry_cap ?? ''}
                      onChange={(event) => setRolloverDrafts((current) => ({
                        ...current,
                        [category.id]: { ...current[category.id], rollover_mode: current[category.id]?.rollover_mode ?? budget?.rollover_mode ?? 'none', carry_cap: event.target.value },
                      }))}
                    />
                  </label>
                </div>
              )}
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
      <SavingsGoalsSection workspaceId={workspaceId} currency={currency} canManage={canManage} />
    </div>
  );
}

function SavingsGoalsSection({ workspaceId, currency, canManage }) {
  const { goals, loading, error, addGoal, addContribution, transitionGoal } = useSavingsGoals(workspaceId);
  const { accounts } = useAccounts(workspaceId);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', targetAmount: '', targetDate: '', accountId: '' });
  const [contributions, setContributions] = useState({});
  const [actionError, setActionError] = useState('');

  const submitGoal = async (event) => {
    event.preventDefault();
    setActionError('');
    try {
      await addGoal(form);
      setForm({ name: '', targetAmount: '', targetDate: '', accountId: '' });
      setShowForm(false);
    } catch (exception) { setActionError(exception.message || 'Не удалось создать цель'); }
  };

  const contribute = async (goal) => {
    const amount = Number(contributions[goal.id]);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setActionError('');
    try {
      await addContribution(goal.id, amount);
      setContributions((current) => ({ ...current, [goal.id]: '' }));
    } catch (exception) { setActionError(exception.message || 'Не удалось добавить накопление'); }
  };

  return (
    <section className="mt-10 border-t border-gray-200 pt-8 dark:border-gray-700">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div><h2 className="flex items-center gap-2 text-xl font-bold"><Target size={20} /> Накопительные цели</h2><p className="text-sm text-gray-600 dark:text-gray-400">Отдельный учёт накоплений и прогресса</p></div>
        {canManage && <button type="button" onClick={() => setShowForm((value) => !value)} className="btn-primary min-h-11"><Plus size={16} className="mr-1" /> Цель</button>}
      </div>
      {(error || actionError) && <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{actionError || error}</p>}
      {showForm && (
        <form onSubmit={submitGoal} className="card mb-4 grid gap-3 sm:grid-cols-2">
          <input className="input-field min-h-11" placeholder="Название цели" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required />
          <input className="input-field min-h-11" type="number" min="0.01" step="0.01" placeholder="Целевая сумма" value={form.targetAmount} onChange={(event) => setForm((current) => ({ ...current, targetAmount: event.target.value }))} required />
          <input className="input-field min-h-11" type="date" value={form.targetDate} onChange={(event) => setForm((current) => ({ ...current, targetDate: event.target.value }))} aria-label="Срок цели" />
          <select className="input-field min-h-11" value={form.accountId} onChange={(event) => setForm((current) => ({ ...current, accountId: event.target.value }))}><option value="">Без привязки к счёту</option>{accounts.filter((account) => !account.is_archived).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select>
          <button className="btn-primary min-h-11 sm:col-span-2" type="submit">Создать цель</button>
        </form>
      )}
      <div className="space-y-3">
        {goals.map((goal) => (
          <article key={goal.id} className="card">
            <div className="flex items-start justify-between gap-3"><div><h3 className="font-medium">{goal.name}</h3><p className="text-sm text-gray-500">{formatMoney(goal.saved_amount, currency)} из {formatMoney(goal.target_amount, currency)}{goal.target_date ? ` · до ${goal.target_date}` : ''}</p></div><span className="text-sm font-semibold text-primary-600">{Math.min(goal.progress_pct, 100).toFixed(0)}%</span></div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"><div className="h-full rounded-full bg-primary-600" style={{ width: `${Math.min(goal.progress_pct, 100)}%` }} /></div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {goal.status === 'active' && <><input type="number" min="0.01" step="0.01" className="input-field min-h-11 min-w-0 flex-1" placeholder="Добавить накопление" value={contributions[goal.id] || ''} onChange={(event) => setContributions((current) => ({ ...current, [goal.id]: event.target.value }))} /><button type="button" className="btn-primary min-h-11" onClick={() => contribute(goal)}>Добавить</button></>}
              {canManage && goal.status === 'active' && <button type="button" className="min-h-11 min-w-11 rounded-lg text-gray-500" title="Поставить на паузу" onClick={() => transitionGoal(goal.id, 'paused')}><Pause size={18} /></button>}
              {canManage && goal.status === 'paused' && <button type="button" className="btn-secondary min-h-11" onClick={() => transitionGoal(goal.id, 'active')}><Play size={16} className="mr-1" /> Продолжить</button>}
              {canManage && !['completed', 'cancelled'].includes(goal.status) && <button type="button" className="min-h-11 min-w-11 rounded-lg text-green-600" title="Завершить" onClick={() => transitionGoal(goal.id, 'completed')}><CheckCircle2 size={18} /></button>}
            </div>
          </article>
        ))}
        {!loading && goals.length === 0 && <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700">Накопительных целей пока нет.</p>}
        {loading && <p className="text-center text-sm text-gray-500">Загрузка целей…</p>}
      </div>
    </section>
  );
}
