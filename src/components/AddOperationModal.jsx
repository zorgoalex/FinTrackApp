import { useState } from 'react';
import { X } from 'lucide-react';

const OPERATION_TYPES = {
  income:  { label: 'Доход',    color: 'text-green-600', bg: 'bg-green-600 hover:bg-green-700' },
  expense: { label: 'Расход',   color: 'text-red-600',   bg: 'bg-red-600 hover:bg-red-700'   },
  salary:  { label: 'Зарплата', color: 'text-blue-600',  bg: 'bg-blue-600 hover:bg-blue-700'  },
};

function todayDateString() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Модальное окно быстрого добавления операции.
 *
 * Props:
 *   type        — 'income' | 'expense' | 'salary'
 *   onClose     — callback закрытия
 *   onSave      — async (payload) => void  (payload = { type, amount, description, operation_date })
 */
export default function AddOperationModal({ type: initialType, onClose, onSave }) {
  const [form, setForm] = useState({
    type:          initialType || 'income',
    amount:        '',
    description:   '',
    operationDate: todayDateString(),
  });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const typeInfo = OPERATION_TYPES[form.type] || OPERATION_TYPES.income;

  const set = (field) => (e) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Введите корректную сумму');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await onSave({
        type:           form.type,
        amount,
        description:    form.description,
        operation_date: form.operationDate,
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
      <div className="bg-white rounded-2xl shadow-xl border border-gray-200 w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className={`text-base font-semibold ${typeInfo.color}`}>
            Новая операция — {typeInfo.label}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Тип */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Тип</label>
            <select
              value={form.type}
              onChange={set('type')}
              className="input-field"
            >
              <option value="income">Доход</option>
              <option value="expense">Расход</option>
              <option value="salary">Зарплата</option>
            </select>
          </div>

          {/* Сумма */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Сумма</label>
            <input
              type="number"
              min="0"
              step="1"
              value={form.amount}
              onChange={set('amount')}
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
