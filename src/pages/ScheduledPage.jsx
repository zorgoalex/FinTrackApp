import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useScheduledOperations } from '../hooks/useScheduledOperations';
import { useCategories } from '../hooks/useCategories';
import { useAccounts } from '../hooks/useAccounts';
import { formatMoney } from '../utils/formatters';
import { CheckCircle2, Plus, Trash2, Pause, Play, Pencil, X } from 'lucide-react';
import { categoryTypeForOperation, operationTypesForWorkspace, OPERATION_TYPE_META } from '../utils/operationTypes';

const FREQ_LABELS = {
  daily: 'Ежедневно',
  weekly: 'Еженедельно',
  monthly: 'Ежемесячно',
  yearly: 'Ежегодно',
};

const TYPE_LABELS = Object.fromEntries(Object.entries(OPERATION_TYPE_META).map(([key, value]) => [key, value.label]));
const TYPE_COLORS = {
  income: 'text-green-600 bg-green-50',
  expense: 'text-red-600 bg-red-50',
  personal_salary: 'text-green-600 bg-green-50',
  employee_salary: 'text-blue-600 bg-blue-50',
};

function todayDateString() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function ScheduledPage() {
  const [searchParams] = useSearchParams();
  const { workspaceId: wsFromCtx, currentWorkspace } = useWorkspace();
  const workspaceId = searchParams.get('workspaceId') || wsFromCtx;

  const { items, history, loading, error, add, update, remove, toggle } = useScheduledOperations(workspaceId);
  const { categories } = useCategories(workspaceId);
  const { accounts } = useAccounts(workspaceId);
  const activeAccounts = accounts.filter(account => !account.is_archived);
  const defaultAccount = activeAccounts.find(account => account.is_default);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ amount: '', type: 'expense', description: '', category_id: '', account_id: '', frequency: 'monthly', next_date: todayDateString() });
  const [deleting, setDeleting] = useState(null);

  const activeItems = items.filter(item => item.is_active);
  const pausedItems = items.filter(item => !item.is_active);

  const activeCategories = useMemo(
    () => categories.filter(c => !c.is_archived && c.type === categoryTypeForOperation(form.type)),
    [categories, form.type]
  );

  const categoryMap = useMemo(() => {
    const m = {};
    categories.forEach(c => { m[c.id] = c; });
    return m;
  }, [categories]);

  const accountMap = useMemo(() => {
    const map = {};
    accounts.forEach(account => { map[account.id] = account; });
    return map;
  }, [accounts]);

  if (!workspaceId) {
    return <div className="max-w-2xl mx-auto p-4 text-center text-gray-500 dark:text-gray-400">Выберите рабочее пространство.</div>;
  }

  const resetForm = () => {
    setForm({ amount: '', type: 'expense', description: '', category_id: '', account_id: defaultAccount?.id || '', frequency: 'monthly', next_date: todayDateString() });
    setShowForm(false);
    setEditingId(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.amount || !form.next_date || !form.account_id) return;
    let saved;
    if (editingId) {
      saved = await update(editingId, form);
    } else {
      saved = await add(form);
    }
    if (saved) resetForm();
  };

  const startEdit = (item) => {
    setForm({
      amount: String(item.amount),
      type: item.type,
      description: item.description || '',
      category_id: item.category_id || '',
      account_id: item.account_id || '',
      frequency: item.frequency,
      next_date: item.next_date,
    });
    setEditingId(item.id);
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (deleting === id) {
      await remove(id);
      setDeleting(null);
    } else {
      setDeleting(id);
      setTimeout(() => setDeleting(null), 3000);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-4 pb-24" data-testid="scheduled-page">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Запланированные</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Регулярные платежи и доходы без повторного ввода</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex min-h-11 shrink-0 items-center gap-1.5 px-3 py-2 rounded-lg bg-primary-600 dark:bg-primary-500 text-white text-sm font-medium hover:bg-primary-700 dark:hover:bg-primary-600 transition-colors btn-press"
          data-testid="add-scheduled-btn"
        >
          <Plus size={16} /> Добавить
        </button>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl p-3 text-sm text-red-700 dark:text-red-400 mb-4">{error}</div>
      )}

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-4 mb-4 space-y-3" data-testid="scheduled-form">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{editingId ? 'Редактировать' : 'Новая запланированная операция'}</h2>
            <button type="button" onClick={resetForm} aria-label="Закрыть форму" className="grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-400 dark:text-gray-500 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"><X size={18} /></button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Сумма</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                className="min-h-11 w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                placeholder="0.00"
                required
                aria-label="Сумма"
                data-testid="scheduled-amount"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Тип</label>
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value, category_id: '' }))}
                className="min-h-11 w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                data-testid="scheduled-type"
                aria-label="Тип операции"
              >
                {operationTypesForWorkspace(currentWorkspace?.workspace_type).filter(type => type !== 'transfer').map(type => (
                  <option key={type} value={type}>{TYPE_LABELS[type]}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Описание</label>
            <input
              type="text"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              placeholder="Аренда, подписка..."
              data-testid="scheduled-description"
              aria-label="Описание"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Счёт</label>
            <select
              value={form.account_id}
              onChange={e => setForm(f => ({ ...f, account_id: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              required
              data-testid="scheduled-account"
              aria-label="Счёт"
            >
              <option value="">Выберите счёт</option>
              {activeAccounts.map(account => (
                <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Категория</label>
              <select
                value={form.category_id}
                onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                data-testid="scheduled-category"
                aria-label="Категория"
              >
                <option value="">Без категории</option>
                {activeCategories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Частота</label>
              <select
                value={form.frequency}
                onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                data-testid="scheduled-frequency"
                aria-label="Частота"
              >
                <option value="daily">Ежедневно</option>
                <option value="weekly">Еженедельно</option>
                <option value="monthly">Ежемесячно</option>
                <option value="yearly">Ежегодно</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Следующая дата</label>
            <input
              type="date"
              value={form.next_date}
              onInput={e => {
                const value = e.currentTarget.value;
                setForm(f => ({ ...f, next_date: value }));
              }}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              required
              data-testid="scheduled-next-date"
              aria-label="Следующая дата"
            />
          </div>

          <button
            type="submit"
            className="min-h-11 w-full px-4 py-2 bg-primary-600 dark:bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-700 dark:hover:bg-primary-600 transition-colors btn-press"
            data-testid="scheduled-submit"
          >
            {editingId ? 'Сохранить' : 'Создать'}
          </button>
        </form>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 dark:border-primary-400 mx-auto"></div>
          <p className="mt-3 text-gray-500 dark:text-gray-400">Загрузка...</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !showForm && items.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-5 py-10 text-center text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400" data-testid="scheduled-empty">
          <p className="text-lg mb-1">Нет запланированных операций</p>
          <p className="text-sm mb-5">Добавьте аренду, подписку, зарплату или другой регулярный платёж.</p>
          <button onClick={() => { resetForm(); setShowForm(true); }} className="min-h-11 rounded-xl bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">
            Создать первую операцию
          </button>
        </div>
      )}

      {/* Items list */}
      {!loading && items.length > 0 && (
        <div className="space-y-5" data-testid="scheduled-list">
          {[{ label: `Активные · ${activeItems.length}`, values: activeItems }, { label: `Приостановлены · ${pausedItems.length}`, values: pausedItems }].filter(section => section.values.length).map(section => (
          <section key={section.label}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{section.label}</h2>
            <div className="space-y-2">
          {section.values.map(item => {
            const cat = categoryMap[item.category_id];
            const account = accountMap[item.account_id];
            return (
              <div
                key={item.id}
                className={`bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-3 transition-opacity ${!item.is_active ? 'opacity-50' : ''}`}
                data-testid="scheduled-item"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-sm font-semibold tabular-nums ${TYPE_COLORS[item.type]?.split(' ')[0] || ''}`}>
                        {formatMoney(item.amount, account?.currency || item.currency || 'KZT')}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${TYPE_COLORS[item.type] || 'text-gray-600 bg-gray-50'}`}>
                        {TYPE_LABELS[item.type] || item.type}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">{FREQ_LABELS[item.frequency]}</span>
                    </div>
                    {item.description && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 truncate">{item.description}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                      <span className="text-xs text-gray-500 dark:text-gray-400">Следующая: {new Date(`${item.next_date}T00:00:00`).toLocaleDateString('ru-RU')}</span>
                      {account && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">{account.name}</span>
                      )}
                      {cat && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                          {cat.name}
                        </span>
                      )}
                    </div>
                    {item.last_error && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">Не выполнено: {item.last_error}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => toggle(item.id, !item.is_active)}
                      aria-label={item.is_active ? 'Приостановить' : 'Возобновить'}
                      className="grid min-h-11 min-w-11 place-items-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                      title={item.is_active ? 'Приостановить' : 'Возобновить'}
                      data-testid="scheduled-toggle"
                    >
                      {item.is_active ? <Pause size={16} /> : <Play size={16} />}
                    </button>
                    <button
                      onClick={() => startEdit(item)}
                      aria-label="Редактировать"
                      className="grid min-h-11 min-w-11 place-items-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                      title="Редактировать"
                      data-testid="scheduled-edit"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      aria-label={deleting === item.id ? 'Подтвердить удаление' : 'Удалить'}
                      className={`grid min-h-11 min-w-11 place-items-center rounded-lg transition-colors ${deleting === item.id ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'}`}
                      title={deleting === item.id ? 'Нажмите ещё раз' : 'Удалить'}
                      data-testid="scheduled-delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
            </div>
          </section>
          ))}
        </div>
      )}

      {!loading && history.length > 0 && (
        <section className="mt-7" data-testid="scheduled-history">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">История выполнения</h2>
            <span className="text-xs text-gray-500 dark:text-gray-400">Последние {history.length}</span>
          </div>
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            {history.map((operation, index) => (
              <div key={operation.id} className={`flex items-center gap-3 p-3 ${index ? 'border-t border-gray-100 dark:border-gray-700' : ''}`}>
                <CheckCircle2 size={18} className="shrink-0 text-green-600 dark:text-green-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{operation.description || TYPE_LABELS[operation.type] || 'Операция'}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Выполнено за {new Date(`${operation.scheduled_for_date || operation.operation_date}T00:00:00`).toLocaleDateString('ru-RU')}</p>
                </div>
                <span className={`shrink-0 text-sm font-semibold tabular-nums ${operation.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>
                  {operation.type === 'income' ? '+' : '−'}{formatMoney(operation.amount, operation.currency || 'KZT')}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
