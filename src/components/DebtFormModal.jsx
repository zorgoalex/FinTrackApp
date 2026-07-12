import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { normalizeAmountInput, formatAmountInput } from '../utils/formatters';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { useCurrencies } from '../hooks/useCurrencies';
import { useCounterparties } from '../hooks/useCounterparties';

const DIRECTIONS = [
  { value: 'i_owe', label: 'Я должен' },
  { value: 'owed_to_me', label: 'Мне должны' },
];

function todayDateString() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function DebtFormModal({ debt, onClose, onSave }) {
  const { workspaceId, currencyCode, currencySymbol } = useWorkspace();
  const { currencies } = useCurrencies(workspaceId);
  const { counterparties } = useCounterparties(workspaceId, { includeArchived: true });
  const isEdit = !!debt;

  const [form, setForm] = useState({
    title: '',
    counterparty: '',
    counterparty_id: '',
    direction: 'i_owe',
    currency: currencyCode,
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
        counterparty_id: debt.counterparty_id || '',
        direction: debt.direction || 'i_owe',
        currency: debt.currency || currencyCode,
        initial_amount: String(debt.initial_amount || ''),
        opened_on: debt.opened_on || todayDateString(),
        due_on: debt.due_on || '',
        notes: debt.notes || '',
      });
    }
  }, [debt, currencyCode]);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const set = (field) => (e) => {
    const value = e.currentTarget.value;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

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
        counterparty_id: form.counterparty_id || null,
        direction: form.direction,
        currency: form.currency,
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm p-0 sm:items-center sm:p-4 animate-backdrop-in" role="dialog" aria-modal="true" aria-labelledby="debt-form-title">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-md max-h-[90vh] overflow-y-auto animate-modal-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 id="debt-form-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {isEdit ? 'Редактировать долг' : 'Новый долг'}
          </h2>
          <button onClick={onClose} aria-label="Закрыть" className="grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-400 dark:text-gray-500 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300">
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
              aria-label="Направление долга"
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
              aria-label="Название долга"
            />
          </div>

          {/* Counterparty */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Контрагент</label>
            <select value={form.counterparty_id} onChange={(event) => { const selected = counterparties.find((item) => item.id === event.target.value); setForm((current) => ({ ...current, counterparty_id: event.target.value, counterparty: selected?.display_name || '' })); }} className="input-field" aria-label="Контрагент">
              <option value="">Выберите из справочника</option>
              {counterparties.filter((item) => !item.is_archived || item.id === form.counterparty_id).map((item) => <option key={item.id} value={item.id}>{item.display_name}{item.is_archived ? ' (архив)' : ''}</option>)}
            </select>
            {counterparties.length === 0 && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Сначала добавьте контрагента в справочниках.</p>}
          </div>

          {/* Amount */}
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Сумма, {form.currency === currencyCode ? currencySymbol : form.currency}</label>
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
              aria-label="Сумма долга"
            />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Валюта</label>
              <select value={form.currency} onChange={set('currency')} className="input-field min-w-24" disabled={isEdit} aria-label="Валюта долга">
                {currencies.map(currency => <option key={currency.code} value={currency.code}>{currency.code}</option>)}
              </select>
            </div>
          </div>

          {/* Opened date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Дата открытия</label>
            <input
              type="date"
              value={form.opened_on}
              onInput={set('opened_on')}
              className="input-field"
              aria-label="Дата открытия"
            />
          </div>

          {/* Due date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Срок погашения (необязательно)</label>
            <input
              type="date"
              value={form.due_on}
              onInput={set('due_on')}
              className="input-field"
              aria-label="Срок погашения"
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
              aria-label="Примечание"
            />
          </div>

          {error && (
            <div className="text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/20 rounded-lg p-3">{error}</div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 flex-1 px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium text-sm"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={loading}
              className="min-h-11 flex-1 px-4 py-2.5 rounded-xl bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 transition-colors font-medium text-sm"
            >
              {loading ? 'Сохранение...' : isEdit ? 'Сохранить' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
