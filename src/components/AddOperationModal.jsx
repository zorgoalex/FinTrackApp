import { useState, useEffect, useRef, useMemo } from 'react';
import { X, Plus } from 'lucide-react';
import { parseAmount, normalizeAmountInput, formatAmountInput, getCurrencySymbol } from '../utils/formatters';
import useCategories from '../hooks/useCategories';
import useTags from '../hooks/useTags';
import useAccounts from '../hooks/useAccounts';
import useDebts from '../hooks/useDebts';
import useCounterparties from '../hooks/useCounterparties';
import { useCurrencies } from '../hooks/useCurrencies';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { usePermissions } from '../hooks/usePermissions';
import TagInput from './TagInput';
import DebtSelector from './DebtSelector';
import { categoryTypeForOperation, operationTypesForWorkspace } from '../utils/operationTypes';
import OperationAllocationsEditor, { allocationsMatchTotal } from './OperationAllocationsEditor';
import VoiceOperationInput from './VoiceOperationInput';
import { parseVoiceOperationTranscript } from '../utils/voiceOperationParser';

const OPERATION_TYPES = {
  income:   { label: 'Доход',    color: 'text-green-600',  bg: 'bg-green-600 hover:bg-green-700' },
  expense:  { label: 'Расход',   color: 'text-red-600',    bg: 'bg-red-600 hover:bg-red-700'   },
  personal_salary: { label: 'Личная зарплата', color: 'text-green-600', bg: 'bg-green-600 hover:bg-green-700' },
  employee_salary: { label: 'Зарплата сотрудникам', color: 'text-blue-600', bg: 'bg-blue-600 hover:bg-blue-700' },
  transfer: { label: 'Перевод',  color: 'text-purple-600', bg: 'bg-purple-600 hover:bg-purple-700' },
};

const MOBILE_ENTITY_TABS = [
  { key: 'account', label: 'Счёт' },
  { key: 'category', label: 'Категория' },
  { key: 'counterparty', label: 'Контрагент' },
];

function todayDateString() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function AddOperationModal({ type: initialType, defaultCategory, workspaceId, onClose, onSave, prefillDebt }) {
  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);
  const { categories, addCategory } = useCategories(workspaceId);
  const { tags } = useTags(workspaceId);
  const { accounts } = useAccounts(workspaceId);
  const { activeDebts } = useDebts(workspaceId);
  const { counterparties } = useCounterparties(workspaceId, { includeArchived: false });
  const { currencyCode: baseCurrency, currencySymbol: baseSymbol, currentWorkspace } = useWorkspace();
  const { canEditDirectories } = usePermissions();
  const { getRate } = useCurrencies(workspaceId);

  const defaultAccount = accounts.find(a => a.is_default);
  const activeAccounts = accounts.filter(a => !a.is_archived);

  const [form, setForm] = useState(() => {
    const type = initialType || 'income';
    return {
      type,
      amount:        '',
      description:   '',
      operationDate: todayDateString(),
      categoryId:    '',
      counterpartyId: '',
      selectedTags:  [],
      accountId:     '',
      fromAccountId: '',
      toAccountId:   '',
      debtId:        prefillDebt?.id || '',
      debtAppliedAmount: '',
      exchangeRate:  '',
      allocations:   [],
    };
  });

  // Derive currency from selected account
  const selectedAccount = useMemo(
    () => activeAccounts.find(a => a.id === form.accountId),
    [activeAccounts, form.accountId]
  );
  const operationCurrency = selectedAccount?.currency || baseCurrency || 'KZT';
  const needsExchangeRate = form.type !== 'transfer' && operationCurrency !== baseCurrency;
  const transferFromAccount = activeAccounts.find(a => a.id === form.fromAccountId);
  const transferToAccount = activeAccounts.find(a => a.id === form.toAccountId);
  const transferFromCurrency = transferFromAccount?.currency || baseCurrency || 'KZT';
  const transferToCurrency = transferToAccount?.currency || baseCurrency || 'KZT';
  const isCrossCurrencyTransfer = form.type === 'transfer'
    && Boolean(transferFromAccount && transferToAccount)
    && transferFromCurrency !== transferToCurrency;
  const amountCurrency = form.type === 'transfer' ? transferFromCurrency : operationCurrency;
  const opCurrencySymbol = getCurrencySymbol(amountCurrency) || amountCurrency;

  // Set default account when accounts load
  useEffect(() => {
    if (defaultAccount && !form.accountId) {
      setForm(prev => ({ ...prev, accountId: defaultAccount.id }));
    }
  }, [defaultAccount, form.accountId]);

  // Auto-fill exchange rate when currency changes
  useEffect(() => {
    if (needsExchangeRate && !form.exchangeRate) {
      const rate = getRate(operationCurrency, baseCurrency, form.operationDate);
      if (rate) setForm(prev => ({ ...prev, exchangeRate: String(rate) }));
    }
  }, [needsExchangeRate, operationCurrency, baseCurrency, form.operationDate, form.exchangeRate, getRate]);

  useEffect(() => {
    if (!isCrossCurrencyTransfer || form.exchangeRate) return;
    const rate = getRate(transferFromCurrency, transferToCurrency, form.operationDate);
    if (rate) setForm(prev => ({ ...prev, exchangeRate: String(rate) }));
  }, [
    isCrossCurrencyTransfer,
    transferFromCurrency,
    transferToCurrency,
    form.operationDate,
    form.exchangeRate,
    getRate,
  ]);

  useEffect(() => {
    if (!form.debtId) return;
    const debt = activeDebts.find(item => item.id === form.debtId);
    if (debt && (debt.currency || baseCurrency) !== operationCurrency) {
      setForm(prev => ({ ...prev, debtId: '', debtAppliedAmount: '' }));
    }
  }, [activeDebts, baseCurrency, form.debtId, operationCurrency]);

  // Pre-fill category when categories load and defaultCategory is provided
  useEffect(() => {
    if (defaultCategory && categories.length > 0 && !form.categoryId) {
      const match = categories.find((c) => c.name === defaultCategory && c.type === categoryTypeForOperation(form.type));
      if (match) setForm((prev) => ({ ...prev, categoryId: match.id }));
    }
  }, [defaultCategory, categories, form.type, form.categoryId]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [amountFocused, setAmountFocused] = useState(false);
  const [mobileEntityTab, setMobileEntityTab] = useState('account');

  // Inline category creation
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const tagInputRef = useRef(null);

  const typeInfo = OPERATION_TYPES[form.type] || OPERATION_TYPES.income;

  const set = (field) => (e) => {
    const value = e.currentTarget.value;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const filteredCategories = categories
    .filter((c) => c.type === categoryTypeForOperation(form.type))
    .filter((c) => !c.is_archived);

  const handleAddCategory = async () => {
    if (!newCatName.trim()) return;
    const catType = categoryTypeForOperation(form.type);
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
    if (form.type === 'transfer') {
      if (!form.fromAccountId || !form.toAccountId) {
        setError('Выберите счета списания и зачисления');
        return;
      }
      if (form.fromAccountId === form.toAccountId) {
        setError('Счета должны отличаться');
        return;
      }
      if (isCrossCurrencyTransfer) {
        const transferRate = parseAmount(form.exchangeRate);
        if (!Number.isFinite(transferRate) || transferRate <= 0) {
          setError(`Укажите курс ${transferFromCurrency} → ${transferToCurrency}`);
          return;
        }
      }
    }
    if (form.type !== 'transfer' && !allocationsMatchTotal(form.allocations, form.amount)) {
      setError('Сумма частей должна точно совпадать с суммой операции');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const payload = form.type === 'transfer'
        ? (() => {
            const transferRate = isCrossCurrencyTransfer ? parseAmount(form.exchangeRate) : 1;
            const toAmount = Math.round(amount * transferRate * 100) / 100;
            return {
            type:            'transfer',
            amount,
            from_amount:     amount,
            to_amount:       toAmount,
            description:     form.description,
            operation_date:  form.operationDate,
            from_account_id: form.fromAccountId,
            to_account_id:   form.toAccountId,
            from_currency:   transferFromCurrency,
            to_currency:     transferToCurrency,
            exchange_rate:   transferRate,
            tagNames:        (tagInputRef.current?.getAllTags() ?? form.selectedTags).map((t) => t.name),
            };
          })()
        : (() => {
            const exchangeRate = needsExchangeRate ? parseAmount(form.exchangeRate) : 1;
            const baseAmount = needsExchangeRate && Number.isFinite(exchangeRate) ? amount * exchangeRate : amount;
            return {
              type:           form.type,
              amount,
              description:    form.description,
              operation_date: form.operationDate,
              category_id:    form.allocations.length >= 2 ? null : (form.categoryId || null),
              counterparty_id: form.allocations.length >= 2 ? null : (form.counterpartyId || null),
              account_id:     form.accountId || defaultAccount?.id || null,
              tagNames:       (tagInputRef.current?.getAllTags() ?? form.selectedTags).map((t) => t.name),
              debt_id:        form.debtId || null,
              debt_applied_amount: form.debtId ? (Number(form.debtAppliedAmount?.replace(',', '.')) || amount) : null,
              currency:       operationCurrency,
              exchange_rate:  needsExchangeRate ? exchangeRate : null,
              base_amount:    Math.round(baseAmount * 100) / 100,
              allocations:    form.allocations.map(({ amount: allocationAmount, category_id, counterparty_id }) => ({
                amount: Number(allocationAmount), category_id: category_id || null, counterparty_id: counterparty_id || null,
              })),
            };
          })();
      const saved = await onSave(payload);
      if (!saved) throw new Error('Операция не была сохранена');
      onClose();
    } catch (err) {
      setError(err.message || 'Ошибка сохранения');
    } finally {
      setLoading(false);
    }
  };

  const handleVoiceTranscript = (transcript) => {
    const parsed = parseVoiceOperationTranscript(transcript, {
      fallbackType: form.type,
      categories,
      accounts: activeAccounts,
    });
    setForm((current) => {
      const typeChanged = Boolean(parsed.patch.type && parsed.patch.type !== current.type);
      return {
        ...current,
        ...(typeChanged ? { categoryId: '', allocations: [] } : {}),
        ...parsed.patch,
      };
    });
    setError(parsed.hasCriticalAmount ? '' : 'Речь распознана, но сумму определить не удалось — укажите её вручную');
    return parsed;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-backdrop-in">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-md max-h-[90vh] overflow-y-auto animate-modal-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className={`text-base font-semibold ${typeInfo.color}`}>
            Новая операция — {typeInfo.label}
          </h2>
          <button type="button" onClick={onClose} aria-label="Закрыть форму операции" className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Тип */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Тип</label>
            <select
              aria-label="Тип операции"
              value={form.type}
              onChange={(e) => {
                const newType = e.target.value;
                setForm((prev) => ({ ...prev, type: newType, categoryId: '', allocations: [] }));
              }}
              className="input-field"
            >
              {operationTypesForWorkspace(currentWorkspace?.workspace_type).map((type) => (
                <option key={type} value={type}>{OPERATION_TYPES[type].label}</option>
              ))}
            </select>
          </div>

          <VoiceOperationInput disabled={loading} onTranscript={handleVoiceTranscript} />

          {/* Compact mobile entity tabs; regular fields on larger screens */}
          {form.type !== 'transfer' && (
            <div className="space-y-4">
              <div
                className="grid grid-cols-3 overflow-hidden rounded-xl border border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-gray-900 sm:hidden"
                role="tablist"
                aria-label="Параметры операции"
              >
                {MOBILE_ENTITY_TABS.map((tab) => {
                  const selected = mobileEntityTab === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      id={`operation-${tab.key}-tab`}
                      aria-selected={selected}
                      aria-controls={`operation-${tab.key}-panel`}
                      onClick={() => setMobileEntityTab(tab.key)}
                      className={`min-h-11 min-w-0 border-r border-gray-300 px-1.5 text-[clamp(0.6875rem,3vw,0.875rem)] font-medium transition-colors last:border-r-0 dark:border-gray-600 ${
                        selected
                          ? 'bg-primary-600 text-white dark:bg-primary-500'
                          : 'text-gray-600 hover:bg-white dark:text-gray-300 dark:hover:bg-gray-800'
                      }`}
                    >
                      <span className="block truncate">{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              <div
                id="operation-account-panel"
                role="tabpanel"
                aria-labelledby="operation-account-tab"
                className={`${mobileEntityTab === 'account' ? 'block' : 'hidden'} ${activeAccounts.length > 1 ? 'sm:block' : 'sm:hidden'}`}
              >
                <label className="mb-1 hidden text-sm font-medium text-gray-700 dark:text-gray-300 sm:block">Счёт</label>
                <select
                  aria-label="Счёт операции"
                  value={form.accountId}
                  onChange={(e) => setForm(prev => ({ ...prev, accountId: e.target.value }))}
                  className="input-field"
                >
                  {activeAccounts.length === 0 && <option value="">Нет доступных счетов</option>}
                  {activeAccounts.map(a => (
                    <option key={a.id} value={a.id}>{a.name}{a.is_default ? ' (основной)' : ''}</option>
                  ))}
                </select>
              </div>

              <div
                id="operation-category-panel"
                role="tabpanel"
                aria-labelledby="operation-category-tab"
                className={`${mobileEntityTab === 'category' ? 'block' : 'hidden'} sm:block`}
              >
                <label className="mb-1 hidden text-sm font-medium text-gray-700 dark:text-gray-300 sm:block">Категория</label>
                <div className="flex gap-2">
                  <select
                    aria-label="Категория операции"
                    value={form.categoryId}
                    onChange={set('categoryId')}
                    className="input-field min-w-0 flex-1"
                    name="category"
                  >
                    <option value="">Без категории</option>
                    {filteredCategories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  {canEditDirectories && (
                    <button
                      type="button"
                      onClick={() => setShowNewCat(!showNewCat)}
                      className="grid min-h-11 min-w-11 place-items-center rounded-lg border border-gray-300 text-gray-500 transition-colors hover:border-primary-400 hover:text-primary-600 dark:border-gray-600 dark:text-gray-400 dark:hover:border-primary-500 dark:hover:text-primary-400"
                      title="Добавить категорию"
                      aria-label="Добавить категорию"
                      data-testid="add-category-btn"
                    >
                      <Plus size={16} />
                    </button>
                  )}
                </div>
                {canEditDirectories && showNewCat && (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="text"
                      value={newCatName}
                      onChange={(e) => setNewCatName(e.target.value)}
                      placeholder="Название категории"
                      className="input-field min-w-0 flex-1 text-sm"
                      data-testid="new-category-name"
                      autoFocus
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCategory(); } }}
                    />
                    <button
                      type="button"
                      onClick={handleAddCategory}
                      className="whitespace-nowrap rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white transition-colors hover:bg-indigo-700"
                      data-testid="save-category-btn"
                    >
                      OK
                    </button>
                  </div>
                )}
              </div>

              <div
                id="operation-counterparty-panel"
                role="tabpanel"
                aria-labelledby="operation-counterparty-tab"
                className={`${mobileEntityTab === 'counterparty' ? 'block' : 'hidden'} ${counterparties.length > 0 ? 'sm:block' : 'sm:hidden'}`}
              >
                <label className="mb-1 hidden text-sm font-medium text-gray-700 dark:text-gray-300 sm:block">Контрагент</label>
                <select aria-label="Контрагент операции" value={form.counterpartyId} onChange={set('counterpartyId')} className="input-field">
                  <option value="">Без контрагента</option>
                  {counterparties.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* Transfer accounts */}
          {form.type === 'transfer' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Со счёта</label>
                <select
                  aria-label="Счёт списания"
                  value={form.fromAccountId}
                  onChange={(e) => setForm(prev => ({ ...prev, fromAccountId: e.target.value, exchangeRate: '' }))}
                  className="input-field"
                >
                  <option value="">Выберите счёт</option>
                  {activeAccounts.map(a => (
                    <option key={a.id} value={a.id}>{a.name} ({a.currency || baseCurrency})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">На счёт</label>
                <select
                  aria-label="Счёт зачисления"
                  value={form.toAccountId}
                  onChange={(e) => setForm(prev => ({ ...prev, toAccountId: e.target.value, exchangeRate: '' }))}
                  className="input-field"
                >
                  <option value="">Выберите счёт</option>
                  {activeAccounts.filter(a => a.id !== form.fromAccountId).map(a => (
                    <option key={a.id} value={a.id}>{a.name} ({a.currency || baseCurrency})</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {form.type !== 'transfer' && <OperationAllocationsEditor operationType={form.type} totalAmount={form.amount} currency={operationCurrency} categories={categories} counterparties={counterparties} allocations={form.allocations} onChange={(allocations) => setForm((current) => ({ ...current, allocations }))} />}

          {/* Сумма */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Сумма, {opCurrencySymbol}</label>
            <input
              aria-label={`Сумма операции, ${amountCurrency}`}
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

          {isCrossCurrencyTransfer && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Курс {transferFromCurrency} → {transferToCurrency}
              </label>
              <input
                aria-label={`Курс ${transferFromCurrency} в ${transferToCurrency}`}
                type="text"
                inputMode="decimal"
                value={form.exchangeRate}
                onChange={(e) => setForm(prev => ({
                  ...prev,
                  exchangeRate: normalizeAmountInput(e.target.value)
                }))}
                className="input-field"
                placeholder="0"
                required
              />
              {form.amount && form.exchangeRate && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  На счёт поступит {formatAmountInput(String(
                    Math.round(parseAmount(form.amount) * parseAmount(form.exchangeRate) * 100) / 100
                  ))} {getCurrencySymbol(transferToCurrency) || transferToCurrency}
                </p>
              )}
            </div>
          )}

          {/* Курс обмена (если валюта ≠ базовой) */}
          {needsExchangeRate && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Курс {operationCurrency} → {baseCurrency}
              </label>
              <input
                aria-label={`Курс ${operationCurrency} в ${baseCurrency}`}
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
              aria-label="Описание операции"
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
          {form.type !== 'transfer' && !form.type.endsWith('_salary') && (
            <DebtSelector
              debts={activeDebts}
              operationType={form.type}
              operationCurrency={operationCurrency}
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
              aria-label="Дата операции"
              type="date"
              value={form.operationDate}
              onInput={set('operationDate')}
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
