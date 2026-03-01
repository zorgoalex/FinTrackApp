import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useScheduledOperations } from '../hooks/useScheduledOperations';
import { useCategories } from '../hooks/useCategories';
import { formatUnsignedAmount } from '../utils/formatters';
import { Plus, Trash2, Pause, Play, Pencil, X } from 'lucide-react';

const FREQ_LABELS = {
  daily: 'Ежедневно',
  weekly: 'Еженедельно',
  monthly: 'Ежемесячно',
  yearly: 'Ежегодно',
};

const TYPE_LABELS = { income: 'Доход', expense: 'Расход', salary: 'Зарплата' };
const TYPE_COLORS = {
  income: 'text-green-600 bg-green-50',
  expense: 'text-red-600 bg-red-50',
  salary: 'text-blue-600 bg-blue-50',
};

export default function ScheduledPage() {
  const [searchParams] = useSearchParams();
  const { workspaceId: wsFromCtx, currencySymbol } = useWorkspace();
  const workspaceId = searchParams.get('workspaceId') || wsFromCtx;

  const { items, loading, error, add, update, remove, toggle } = useScheduledOperations(workspaceId);
  const { categories } = useCategories(workspaceId);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ amount: '', type: 'expense', description: '', category_id: '', frequency: 'monthly', next_date: '' });
  const [deleting, setDeleting] = useState(null);

  const activeCategories = useMemo(
    () => categories.filter(c => !c.is_archived),
    [categories]
  );

  const categoryMap = useMemo(() => {
    const m = {};
    categories.forEach(c => { m[c.id] = c; });
    return m;
  }, [categories]);

  if (!workspaceId) {
    return <div className="max-w-2xl mx-auto p-4 text-center text-gray-500 dark:text-gray-400">Выберите рабочее пространство.</div>;
  }

  const resetForm = () => {
    setForm({ amount: '', type: 'expense', description: '', category_id: '', frequency: 'monthly', next_date: '' });
    setShowForm(false);
    setEditingId(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.amount || !form.next_date) return;
    if (editingId) {
      await update(editingId, form);
    } else {
      await add(form);
    }
    resetForm();
  };

  const startEdit = (item) => {
    setForm({
      amount: String(item.amount),
      type: item.type,
      description: item.description || '',
      category_id: item.category_id || '',
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
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Запланированные</h1>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 dark:bg-primary-500 text-white text-sm font-medium hover:bg-primary-700 dark:hover:bg-primary-600 transition-colors btn-press"
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
            <button type="button" onClick={resetForm} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"><X size={18} /></button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Сумма</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                placeholder="0.00"
                required
                data-testid="scheduled-amount"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Тип</label>
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                data-testid="scheduled-type"
              >
                <option value="income">Доход</option>
                <option value="expense">Расход</option>
                <option value="salary">Зарплата</option>
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
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Категория</label>
              <select
                value={form.category_id}
                onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                data-testid="scheduled-category"
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
              onChange={e => setForm(f => ({ ...f, next_date: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              required
              data-testid="scheduled-next-date"
            />
          </div>

          <button
            type="submit"
            className="w-full px-4 py-2 bg-primary-600 dark:bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-700 dark:hover:bg-primary-600 transition-colors btn-press"
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
      {!loading && items.length === 0 && (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500" data-testid="scheduled-empty">
          <p className="text-lg mb-1">Нет запланированных операций</p>
          <p className="text-sm">Добавьте повторяющиеся платежи и доходы</p>
        </div>
      )}

      {/* Items list */}
      {!loading && items.length > 0 && (
        <div className="space-y-2" data-testid="scheduled-list">
          {items.map(item => {
            const cat = categoryMap[item.category_id];
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
                        {formatUnsignedAmount(item.amount, currencySymbol)}
                      </span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${TYPE_COLORS[item.type] || 'text-gray-600 bg-gray-50'}`}>
                        {TYPE_LABELS[item.type] || item.type}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">{FREQ_LABELS[item.frequency]}</span>
                    </div>
                    {item.description && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 truncate">{item.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-gray-400 dark:text-gray-500">Следующая: {item.next_date}</span>
                      {cat && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                          {cat.name}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => toggle(item.id, !item.is_active)}
                      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                      title={item.is_active ? 'Приостановить' : 'Возобновить'}
                      data-testid="scheduled-toggle"
                    >
                      {item.is_active ? <Pause size={16} /> : <Play size={16} />}
                    </button>
                    <button
                      onClick={() => startEdit(item)}
                      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                      title="Редактировать"
                      data-testid="scheduled-edit"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className={`p-1.5 rounded-lg transition-colors ${deleting === item.id ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'}`}
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
      )}
    </div>
  );
}
