import { useState, useEffect } from 'react';
import { X, Plus } from 'lucide-react';
import { parseAmount, normalizeAmountInput, formatAmountInput } from '../utils/formatters';
import useCategories from '../hooks/useCategories';
import useTags from '../hooks/useTags';
import TagInput from './TagInput';

const OPERATION_TYPES = {
  income:  { label: 'Доход',    color: 'text-green-600', bg: 'bg-green-600 hover:bg-green-700' },
  expense: { label: 'Расход',   color: 'text-red-600',   bg: 'bg-red-600 hover:bg-red-700'   },
  salary:  { label: 'Зарплата', color: 'text-blue-600',  bg: 'bg-blue-600 hover:bg-blue-700'  },
};

export default function EditOperationModal({ operation, workspaceId, onClose, onSave }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const { categories, addCategory } = useCategories(workspaceId);
  const { tags } = useTags(workspaceId);

  const [form, setForm] = useState({
    amount:        String(operation.amount || ''),
    description:   operation.description || '',
    operationDate: operation.operation_date || '',
    categoryId:    operation.category_id || '',
    selectedTags:  operation.tags || [],
  });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [amountFocused, setAmountFocused] = useState(false);

  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');

  const typeInfo = OPERATION_TYPES[operation.type] || OPERATION_TYPES.income;

  const set = (field) => (e) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const filteredCategories = operation.type === 'salary'
    ? []
    : categories.filter((c) => c.type === operation.type);

  const handleAddCategory = async () => {
    if (!newCatName.trim()) return;
    const catType = operation.type === 'income' ? 'income' : 'expense';
    const created = await addCategory({ name: newCatName.trim(), type: catType });
    if (created) {
      setForm((prev) => ({ ...prev, categoryId: created.id }));
      setNewCatName('');
      setShowNewCat(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const amount = parseAmount(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Введите корректную сумму');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await onSave(operation.id, {
        amount,
        description:    form.description,
        operation_date: form.operationDate,
        category_id:    form.categoryId || null,
        tagNames:       form.selectedTags.map((t) => t.name),
      });
      onClose();
    } catch (err) {
      setError(err.message || 'Ошибка сохранения');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-200 w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className={`text-base font-semibold ${typeInfo.color}`}>
            Редактировать — {typeInfo.label}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Категория */}
          {operation.type !== 'salary' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Категория</label>
              <div className="flex gap-2">
                <select
                  value={form.categoryId}
                  onChange={set('categoryId')}
                  className="input-field flex-1"
                  name="category"
                >
                  <option value="">Без категории</option>
                  {filteredCategories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowNewCat(!showNewCat)}
                  className="px-2 py-1 border border-gray-300 rounded-lg text-gray-500 hover:text-indigo-600 hover:border-indigo-400 transition-colors"
                  title="Добавить категорию"
                >
                  <Plus size={16} />
                </button>
              </div>
              {showNewCat && (
                <div className="mt-2 flex gap-2 items-center">
                  <input
                    type="text"
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    placeholder="Название категории"
                    className="input-field flex-1 text-sm"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCategory(); } }}
                  />
                  <button
                    type="button"
                    onClick={handleAddCategory}
                    className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap"
                  >
                    OK
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Сумма */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Сумма, ₽</label>
            <input
              type="text"
              inputMode="decimal"
              value={amountFocused ? form.amount : formatAmountInput(form.amount)}
              onFocus={() => setAmountFocused(true)}
              onBlur={() => setAmountFocused(false)}
              onChange={(e) => setForm((prev) => ({
                ...prev,
                amount: normalizeAmountInput(e.target.value)
              }))}
              className="input-field"
              placeholder="0"
              required
              autoFocus
            />
          </div>

          {/* Описание */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Описание</label>
            <textarea
              value={form.description}
              onChange={set('description')}
              className="input-field"
              rows={2}
              placeholder="Комментарий к операции"
            />
          </div>

          {/* Теги */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Теги</label>
            <TagInput
              allTags={tags}
              selected={form.selectedTags}
              onChange={(newTags) => setForm((prev) => ({ ...prev, selectedTags: newTags }))}
              placeholder="Добавить тег..."
            />
          </div>

          {/* Дата */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Дата</label>
            <input
              type="date"
              value={form.operationDate}
              onChange={set('operationDate')}
              className="input-field"
              required
            />
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          {/* Buttons */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="btn-secondary"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={loading}
              className={`px-4 py-2 rounded-lg text-white text-sm font-medium transition-colors ${typeInfo.bg} disabled:opacity-50`}
            >
              {loading ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
