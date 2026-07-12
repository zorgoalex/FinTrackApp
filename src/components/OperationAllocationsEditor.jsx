import { Plus, Split, Trash2 } from 'lucide-react';
import { categoryTypeForOperation } from '../utils/operationTypes';

function amountNumber(value) {
  const number = Number(String(value ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(number) ? number : 0;
}

export default function OperationAllocationsEditor({
  operationType,
  totalAmount,
  currency = 'KZT',
  categories = [],
  counterparties = [],
  allocations = [],
  onChange,
}) {
  const total = amountNumber(totalAmount);
  const allocated = allocations.reduce((sum, item) => sum + amountNumber(item.amount), 0);
  const remainder = Math.round((total - allocated) * 100) / 100;
  const relevantCategories = categories.filter((item) => !item.is_archived && item.type === categoryTypeForOperation(operationType));

  const start = () => onChange([
    { key: globalThis.crypto.randomUUID(), amount: total ? String(total) : '', category_id: '', counterparty_id: '' },
    { key: globalThis.crypto.randomUUID(), amount: '', category_id: '', counterparty_id: '' },
  ]);
  const update = (index, patch) => onChange(allocations.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  const remove = (index) => {
    const next = allocations.filter((_, itemIndex) => itemIndex !== index);
    onChange(next.length >= 2 ? next : []);
  };

  if (allocations.length < 2) return <button type="button" onClick={start} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary-300 text-sm font-medium text-primary-700 hover:bg-primary-50 dark:border-primary-700 dark:text-primary-300 dark:hover:bg-primary-950/30"><Split size={17} />Разделить по категориям или контрагентам</button>;

  return <div className="space-y-2 rounded-xl border border-primary-200 bg-primary-50/50 p-3 dark:border-primary-900 dark:bg-primary-950/20">
    <div className="flex items-center justify-between"><p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Разделение операции</p><span className={`text-xs font-semibold tabular-nums ${Math.abs(remainder) < 0.005 ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>{Math.abs(remainder) < 0.005 ? 'Сумма совпадает' : `Осталось ${remainder.toLocaleString('ru-RU')} ${currency}`}</span></div>
    {allocations.map((item, index) => <div key={item.key || index} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-xl border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-800 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)_auto]">
      <input aria-label={`Сумма части ${index + 1}`} className="input-field" type="number" min="0.01" step="0.01" value={item.amount} onChange={(event) => update(index, { amount: event.target.value })} placeholder="Сумма" />
      <select aria-label={`Категория части ${index + 1}`} className="input-field col-span-2 sm:col-span-1" value={item.category_id || ''} onChange={(event) => update(index, { category_id: event.target.value })}><option value="">Без категории</option>{relevantCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
      <select aria-label={`Контрагент части ${index + 1}`} className="input-field col-span-2 sm:col-span-1" value={item.counterparty_id || ''} onChange={(event) => update(index, { counterparty_id: event.target.value })}><option value="">Без контрагента</option>{counterparties.filter((counterparty) => !counterparty.is_archived).map((counterparty) => <option key={counterparty.id} value={counterparty.id}>{counterparty.display_name}</option>)}</select>
      <button type="button" onClick={() => remove(index)} className="grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30" aria-label={`Удалить часть ${index + 1}`}><Trash2 size={16} /></button>
    </div>)}
    <button type="button" onClick={() => onChange([...allocations, { key: globalThis.crypto.randomUUID(), amount: remainder > 0 ? String(remainder) : '', category_id: '', counterparty_id: '' }])} className="flex min-h-11 items-center gap-2 text-sm font-medium text-primary-700 dark:text-primary-300"><Plus size={16} />Добавить часть</button>
  </div>;
}

export function allocationsMatchTotal(allocations, totalAmount) {
  if (!allocations || allocations.length < 2) return true;
  const total = amountNumber(totalAmount);
  const allocated = allocations.reduce((sum, item) => sum + amountNumber(item.amount), 0);
  return allocations.every((item) => amountNumber(item.amount) > 0 && item.category_id) && Math.abs(total - allocated) < 0.005;
}
