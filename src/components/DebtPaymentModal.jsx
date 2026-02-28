import { useState, useEffect, useRef } from 'react';
import { X, Plus } from 'lucide-react';
import { parseAmount, normalizeAmountInput, formatAmountInput, formatUnsignedAmount } from '../utils/formatters';
import { useOperations } from '../hooks/useOperations';
import useAccounts from '../hooks/useAccounts';
import useCategories from '../hooks/useCategories';
import useTags from '../hooks/useTags';
import TagInput from './TagInput';

function todayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function DebtPaymentModal({ debt, workspaceId, onClose, onDone }) {
  const isIOwe = debt.direction === 'i_owe';
  const operationType = isIOwe ? 'expense' : 'income';

  const { addOperation } = useOperations(workspaceId);
  const { accounts } = useAccounts(workspaceId);
  const { categories, addCategory } = useCategories(workspaceId);
  const { tags } = useTags(workspaceId);
  const activeAccounts = accounts.filter(a => !a.is_archived);
  const defaultAccount = accounts.find(a => a.is_default);
  const tagInputRef = useRef(null);

  const filteredCategories = categories
    .filter((c) => c.type === operationType)
    .filter((c) => !c.is_archived);

  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [operationDate, setOperationDate] = useState(todayDateString());
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [amountFocused, setAmountFocused] = useState(false);
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');

  const handleAddCategory = async () => {
    if (!newCatName.trim()) return;
    const created = await addCategory({ name: newCatName.trim(), type: operationType });
    if (created) {
      setCategoryId(created.id);
      setNewCatName('');
      setShowNewCat(false);
    }
  };

  // Set default account when accounts load
  useEffect(() => {
    if (defaultAccount && !accountId) {
      setAccountId(defaultAccount.id);
    }
  }, [defaultAccount, accountId]);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const parsedAmount = parseAmount(amount);

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Введите корректную сумму');
      return;
    }
    if (parsedAmount > debt.remaining_amount) {
      setError(`Сумма не может превышать остаток долга (${formatUnsignedAmount(debt.remaining_amount)})`);
      return;
    }

    setLoading(true);
    setError('');
    try {
      await addOperation({
        type: operationType,
        amount: parsedAmount,
        description,
        operation_date: operationDate,
        account_id: accountId || defaultAccount?.id || null,
        category_id: categoryId || null,
        tagNames: (tagInputRef.current?.getAllTags() ?? selectedTags).map((t) => t.name),
        debt_id: debt.id,
        debt_applied_amount: parsedAmount,
      });
      if (onDone) await onDone();
      onClose();
    } catch (err) {
      setError(err.message || 'Ошибка сохранения');
    } finally {
      setLoading(false);
    }
  };

  const typeColor = isIOwe ? 'text-red-600' : 'text-green-600';
  const btnBg = isIOwe ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-backdrop-in">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-md max-h-[90vh] overflow-y-auto animate-modal-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className={`text-base font-semibold ${typeColor}`}>
            {isIOwe ? 'Оплата долга' : 'Получение платежа'}
          </h2>
          <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
            <X size={20} />
          </button>
        </div>

        {/* Debt info */}
        <div className="px-5 pt-4 pb-2">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{debt.title}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{debt.counterparty}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Остаток: <span className="font-semibold text-gray-700 dark:text-gray-300">{formatUnsignedAmount(debt.remaining_amount)}</span> из {formatUnsignedAmount(debt.initial_amount)}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-5 pb-5 space-y-4">
          {/* Amount */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Сумма платежа, ₽</label>
            <input
              type="text"
              inputMode="decimal"
              value={amountFocused ? amount : formatAmountInput(amount)}
              onFocus={() => setAmountFocused(true)}
              onBlur={() => setAmountFocused(false)}
              onChange={(e) => setAmount(normalizeAmountInput(e.target.value))}
              className="input-field"
              placeholder={`макс. ${formatUnsignedAmount(debt.remaining_amount)}`}
              required
              autoFocus
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Категория</label>
            <div className="flex gap-2">
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="input-field flex-1"
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
          </div>

          {/* Account */}
          {activeAccounts.length > 1 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Счёт</label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="input-field"
              >
                {activeAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name}{a.is_default ? ' (основной)' : ''}</option>
                ))}
              </select>
            </div>
          )}

          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Дата</label>
            <input
              type="date"
              value={operationDate}
              onChange={(e) => setOperationDate(e.target.value)}
              className="input-field"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Комментарий</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input-field"
              rows={2}
              placeholder={isIOwe ? 'Платёж по долгу' : 'Возврат долга'}
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Теги</label>
            <TagInput
              ref={tagInputRef}
              allTags={tags}
              selected={selectedTags}
              onChange={(newTags) => setSelectedTags(newTags)}
              placeholder="Добавить тег..."
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg p-3">{error}</p>
          )}

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium text-sm"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={loading}
              className={`flex-1 px-4 py-2.5 rounded-xl text-white font-medium text-sm transition-colors disabled:opacity-50 ${btnBg}`}
            >
              {loading ? 'Сохранение...' : isIOwe ? 'Оплатить' : 'Принять платёж'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
