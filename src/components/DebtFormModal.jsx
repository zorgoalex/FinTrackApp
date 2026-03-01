import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { normalizeAmountInput, formatAmountInput } from '../utils/formatters';
import { useWorkspace } from '../contexts/WorkspaceContext';

const DIRECTIONS = [
  { value: 'i_owe', label: 'Я должен' },
  { value: 'owed_to_me', label: 'Мне должны' },
];

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

export default function DebtFormModal({ debt, onClose, onSave }) {
  const { currencySymbol } = useWorkspace();
  const isEdit = !!debt;

  const [form, setForm] = useState({
    title: '',
    counterparty: '',
    direction: 'i_owe',
    initial_amount: '',
    opened_on: todayDateString(),
    due_on: '',
    notes: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [amountFocused, setAmountFocused] = useState(false);

  useEffect(() => {
    if (debt) {
      setForm({
        title: debt.title || '',
        counterparty: debt.counterparty || '',
        direction: debt.direction || 'i_owe',
        initial_amount: String(debt.initial_amount || ''),
        opened_on: debt.opened_on || todayDateString(),
        due_on: debt.due_on || '',
        notes: debt.notes || '',
      });
    }
  }, [debt]);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) { setError('Введите название'); return; }
    if (!form.counterparty.trim()) { setError('Введите контрагента'); return; }
    const amount = Number(form.initial_amount.replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) { setError('Введите корректную сумму'); return; }

    setLoading(true);
    setError('');
    try {
      await onSave({
        title: form.title,
        counterparty: form.counterparty,
        direction: form.direction,
        initial_amount: amount,
        opened_on: form.opened_on || todayDateString(),
        due_on: form.due_on || null,
        notes: form.notes || null,
      });
      onClose();
    } catch (err) {
      setError(err.message || 'Ошибка сохранения');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-backdrop-in">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-md max-h-[90vh] overflow-y-auto animate-modal-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {isEdit ? 'Редактировать долг' : 'Новый долг'}
          </h2>
          <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Direction */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Направление</label>
            <select
              value={form.direction}
              onChange={set('direction')}
              className="input-field"
              disabled={isEdit}
            >
              {DIRECTIONS.map(d => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Название</label>
            <input
              type="text"
              value={form.title}
              onChange={set('title')}
              className="input-field"
              placeholder="Кредит на машину, долг Васе..."
              required
              autoFocus
            />
          </div>

          {/* Counterparty */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Контрагент</label>
            <input
              type="text"
              value={form.counterparty}
              onChange={set('counterparty')}
              className="input-field"
              placeholder="Банк, ФИО, компания..."
              required
            />
          </div>

          {/* Amount */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Сумма, {currencySymbol}</label>
            <input
              type="text"
              inputMode="decimal"
              value={amountFocused ? form.initial_amount : formatAmountInput(form.initial_amount)}
              onFocus={() => setAmountFocused(true)}
              onBlur={() => setAmountFocused(false)}
              onChange={(e) => setForm(prev => ({ ...prev, initial_amount: normalizeAmountInput(e.target.value) }))}
              className="input-field"
              placeholder="0"
              required
            />
          </div>

          {/* Opened date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Дата открытия</label>
            <input
              type="date"
              value={form.opened_on}
              onChange={set('opened_on')}
              className="input-field"
            />
          </div>

          {/* Due date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Срок погашения (необязательно)</label>
            <input
              type="date"
              value={form.due_on}
              onChange={set('due_on')}
              className="input-field"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Примечание</label>
            <textarea
              value={form.notes}
              onChange={set('notes')}
              className="input-field"
              rows={2}
              placeholder="Условия, проценты..."
            />
          </div>

          {error && (
            <div className="text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/20 rounded-lg p-3">{error}</div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium text-sm"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2.5 rounded-xl bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 transition-colors font-medium text-sm"
            >
              {loading ? 'Сохранение...' : isEdit ? 'Сохранить' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
