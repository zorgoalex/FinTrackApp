import { useMemo } from 'react';
import { formatUnsignedAmount } from '../utils/formatters';

/**
 * Dropdown selector for linking operation to a debt.
 * Shows only debts matching the operation type direction:
 *   expense → i_owe debts
 *   income  → owed_to_me debts
 */
export default function DebtSelector({ debts, operationType, selectedDebtId, onDebtChange, appliedAmount, onAppliedAmountChange, operationAmount }) {
  const directionForType = operationType === 'expense' ? 'i_owe' : operationType === 'income' ? 'owed_to_me' : null;

  const filteredDebts = useMemo(() => {
    if (!directionForType) return [];
    return (debts || []).filter(d => !d.is_archived && d.remaining_amount > 0 && d.direction === directionForType);
  }, [debts, directionForType]);

  if (!directionForType || filteredDebts.length === 0) return null;

  const selectedDebt = filteredDebts.find(d => d.id === selectedDebtId);
  const maxApplied = selectedDebt ? Math.min(Number(operationAmount) || 0, selectedDebt.remaining_amount) : 0;

  return (
    <div className="space-y-2">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {directionForType === 'i_owe' ? 'Привязать к долгу (я должен)' : 'Привязать к долгу (мне должны)'}
        </label>
        <select
          value={selectedDebtId || ''}
          onChange={(e) => {
            const debtId = e.target.value || null;
            onDebtChange(debtId);
            if (debtId && !appliedAmount) {
              const debt = filteredDebts.find(d => d.id === debtId);
              if (debt) {
                const defaultApplied = Math.min(Number(operationAmount) || 0, debt.remaining_amount);
                onAppliedAmountChange(defaultApplied > 0 ? String(defaultApplied) : '');
              }
            }
            if (!debtId) onAppliedAmountChange('');
          }}
          className="input-field"
        >
          <option value="">Без привязки к долгу</option>
          {filteredDebts.map(d => (
            <option key={d.id} value={d.id}>
              {d.title} — {d.counterparty} (ост. {formatUnsignedAmount(d.remaining_amount)})
            </option>
          ))}
        </select>
      </div>

      {selectedDebtId && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Сумма погашения долга, ₽
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={appliedAmount || ''}
            onChange={(e) => onAppliedAmountChange(e.target.value)}
            className="input-field"
            placeholder={maxApplied > 0 ? `макс. ${maxApplied}` : '0'}
          />
          {selectedDebt && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Остаток долга: {formatUnsignedAmount(selectedDebt.remaining_amount)} из {formatUnsignedAmount(selectedDebt.initial_amount)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
