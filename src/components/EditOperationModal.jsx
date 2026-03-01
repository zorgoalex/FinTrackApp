import { useState, useEffect, useRef, useMemo } from 'react';
import { X, Plus } from 'lucide-react';
import { parseAmount, normalizeAmountInput, formatAmountInput, getCurrencySymbol } from '../utils/formatters';
import useCategories from '../hooks/useCategories';
import useTags from '../hooks/useTags';
import useAccounts from '../hooks/useAccounts';
import useDebts from '../hooks/useDebts';
import { useCurrencies } from '../hooks/useCurrencies';
import { useWorkspace } from '../contexts/WorkspaceContext';
import TagInput from './TagInput';
import DebtSelector from './DebtSelector';

const OPERATION_TYPES = {
  income:   { label: 'Доход',    color: 'text-green-600',  bg: 'bg-green-600 hover:bg-green-700' },
  expense:  { label: 'Расход',   color: 'text-red-600',    bg: 'bg-red-600 hover:bg-red-700'   },
  salary:   { label: 'Зарплата', color: 'text-blue-600',   bg: 'bg-blue-600 hover:bg-blue-700'  },
  transfer: { label: 'Перевод',  color: 'text-purple-600', bg: 'bg-purple-600 hover:bg-purple-700' },
};

export default function EditOperationModal({ operation, workspaceId, onClose, onSave }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const { categories, addCategory } = useCategories(workspaceId);
  const { tags } = useTags(workspaceId);
  const { accounts } = useAccounts(workspaceId);
  const { activeDebts } = useDebts(workspaceId);
  const { currencyCode: baseCurrency, currencySymbol: baseSymbol } = useWorkspace();
  const { getRate } = useCurrencies(workspaceId);

  const activeAccounts = accounts.filter(a => !a.is_archived);
  const isTransfer = operation.type === 'transfer';

  // For transfers, find the linked 'in' operation to get toAccountId
  const [form, setForm] = useState({
    amount:        String(operation.amount || ''),
    description:   operation.description || '',
    operationDate: operation.operation_date || '',
    categoryId:    operation.category_id || '',
    selectedTags:  operation.tags || [],
    accountId:     operation.account_id || '',
    fromAccountId: isTransfer && operation.transfer_direction === 'out' ? (operation.account_id || '') : '',
    toAccountId:   isTransfer && operation.transfer_direction === 'in' ? (operation.account_id || '') : '',
    debtId:            operation.debt_id || '',
    debtAppliedAmount: operation.debt_applied_amount ? String(operation.debt_applied_amount) : '',
    exchangeRate:      operation.exchange_rate ? String(operation.exchange_rate) : '',
  });

  const operationCurrency = operation.currency || baseCurrency || 'KZT';
  const needsExchangeRate = operationCurrency !== baseCurrency;
  const opCurrencySymbol = getCurrencySymbol(operationCurrency) || operationCurrency;

  // For transfer 'out' operations, find the linked 'in' op to fill toAccountId
  useEffect(() => {
    if (isTransfer && operation._linkedAccountId) {
      if (operation.transfer_direction === 'out') {
        setForm(prev => ({ ...prev, toAccountId: prev.toAccountId || operation._linkedAccountId }));
      } else {
        setForm(prev => ({ ...prev, fromAccountId: prev.fromAccountId || operation._linkedAccountId }));
      }
    }
  }, [isTransfer, operation._linkedAccountId, operation.transfer_direction]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [amountFocused, setAmountFocused] = useState(false);

  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const tagInputRef = useRef(null);

  const typeInfo = OPERATION_TYPES[operation.type] || OPERATION_TYPES.income;

  const set = (field) => (e) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const filteredCategories = (operation.type === 'salary'
    ? categories.filter((c) => c.type === 'expense')
    : categories.filter((c) => c.type === operation.type)
  ).filter((c) => !c.is_archived || c.id === form.categoryId);

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
      const payload = isTransfer
        ? {
            _isTransfer: true,
            _transferGroupId: operation.transfer_group_id,
            amount,
            description:     form.description,
            operation_date:  form.operationDate,
            from_account_id: form.fromAccountId || undefined,
            to_account_id:   form.toAccountId || undefined,
            tagNames:        (tagInputRef.current?.getAllTags() ?? form.selectedTags).map((t) => t.name),
          }
        : (() => {
            const exchangeRate = needsExchangeRate ? parseAmount(form.exchangeRate) : 1;
            const baseAmount = needsExchangeRate && Number.isFinite(exchangeRate) ? amount * exchangeRate : amount;
            return {
              amount,
              description:    form.description,
              operation_date: form.operationDate,
              category_id:    form.categoryId || null,
              account_id:     form.accountId || undefined,
              tagNames:       (tagInputRef.current?.getAllTags() ?? form.selectedTags).map((t) => t.name),
              debt_id:        form.debtId || null,
              debt_applied_amount: form.debtId ? (Number(form.debtAppliedAmount?.replace(',', '.')) || amount) : null,
              currency:       operationCurrency,
              exchange_rate:  needsExchangeRate ? exchangeRate : null,
              base_amount:    Math.round(baseAmount * 100) / 100,
            };
          })();
      await onSave(operation.id, payload);
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
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className={`text-base font-semibold ${typeInfo.color}`}>
            Редактировать — {typeInfo.label}
          </h2>
          <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Transfer accounts */}
          {isTransfer && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Со счёта</label>
                <select
                  value={form.fromAccountId}
                  onChange={(e) => setForm(prev => ({ ...prev, fromAccountId: e.target.value }))}
                  className="input-field"
                >
                  <option value="">Выберите счёт</option>
                  {activeAccounts.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">На счёт</label>
                <select
                  value={form.toAccountId}
                  onChange={(e) => setForm(prev => ({ ...prev, toAccountId: e.target.value }))}
                  className="input-field"
                >
                  <option value="">Выберите счёт</option>
                  {activeAccounts.filter(a => a.id !== form.fromAccountId).map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* Счёт (for non-transfer) */}
          {!isTransfer && activeAccounts.length > 1 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Счёт</label>
              <select
                value={form.accountId}
                onChange={(e) => setForm(prev => ({ ...prev, accountId: e.target.value }))}
                className="input-field"
              >
                {activeAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name}{a.is_default ? ' (основной)' : ''}</option>
                ))}
              </select>
            </div>
          )}

          {/* Категория (hidden for transfers) */}
          {!isTransfer && <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Категория</label>
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
                  className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 hover:border-primary-400 dark:hover:border-primary-500 transition-colors"
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
            </div>}

          {/* Сумма */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Сумма, {opCurrencySymbol}</label>
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

          {/* Курс обмена (если валюта ≠ базовой) */}
          {needsExchangeRate && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Курс {operationCurrency} → {baseCurrency}
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={form.exchangeRate}
                onChange={(e) => setForm((prev) => ({
                  ...prev,
                  exchangeRate: normalizeAmountInput(e.target.value)
                }))}
                className="input-field"
                placeholder="0"
              />
              {form.amount && form.exchangeRate && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  = {formatAmountInput(String(Math.round(parseAmount(form.amount) * parseAmount(form.exchangeRate) * 100) / 100))} {baseSymbol}
                </p>
              )}
            </div>
          )}

          {/* Описание */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Описание</label>
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
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Теги</label>
            <TagInput
              ref={tagInputRef}
              allTags={tags}
              selected={form.selectedTags}
              onChange={(newTags) => setForm((prev) => ({ ...prev, selectedTags: newTags }))}
              placeholder="Добавить тег..."
            />
          </div>

          {/* Debt selector (expense/income only) */}
          {!isTransfer && operation.type !== 'salary' && (
            <DebtSelector
              debts={activeDebts}
              operationType={operation.type}
              selectedDebtId={form.debtId}
              onDebtChange={(debtId) => setForm(prev => ({ ...prev, debtId: debtId || '' }))}
              appliedAmount={form.debtAppliedAmount}
              onAppliedAmountChange={(val) => setForm(prev => ({ ...prev, debtAppliedAmount: val }))}
              operationAmount={form.amount}
            />
          )}

          {/* Дата */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Дата</label>
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
