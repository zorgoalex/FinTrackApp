import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Plus, X } from 'lucide-react';
import { supabase } from '../contexts/AuthContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { usePermissions } from '../hooks/usePermissions';
import { useAccounts } from '../hooks/useAccounts';
import { useCategories } from '../hooks/useCategories';
import { useCurrencies } from '../hooks/useCurrencies';
import { useScheduledOperations } from '../hooks/useScheduledOperations';
import { useDebts } from '../hooks/useDebts';
import { buildCashflowForecast, expandScheduled, getDebtForecastDate } from '../utils/cashflowForecast';
import { formatBalance, formatUnsignedAmount } from '../utils/formatters';

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (value, days) => {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};
const SOURCE_LABELS = { plan: 'План', scheduled: 'Регулярный', debt: 'Долг' };

export default function CashflowPage() {
  const [searchParams] = useSearchParams();
  const { workspaceId: contextWorkspaceId, currencyCode, currencySymbol } = useWorkspace();
  const workspaceId = searchParams.get('workspaceId') || contextWorkspaceId;
  const { canCreateOperations } = usePermissions();
  const { accounts } = useAccounts(workspaceId);
  const { categories } = useCategories(workspaceId);
  const { getRate } = useCurrencies(workspaceId);
  const { items: scheduledItems } = useScheduledOperations(workspaceId);
  const { activeDebts } = useDebts(workspaceId);
  const [horizon, setHorizon] = useState(30);
  const [plans, setPlans] = useState([]);
  const [openingBalance, setOpeningBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: '', direction: 'expense', amount: '', planned_date: today(), account_id: '', category_id: '', notes: '' });

  const activeAccounts = useMemo(() => accounts.filter((account) => !account.is_archived), [accounts]);
  const accountMap = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const defaultAccount = activeAccounts.find((account) => account.is_default) || activeAccounts[0];

  useEffect(() => {
    if (defaultAccount && !form.account_id) setForm((current) => ({ ...current, account_id: defaultAccount.id }));
  }, [defaultAccount, form.account_id]);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError('');
    const [plansResult, balancesResult] = await Promise.all([
      supabase.from('cashflow_plans').select('*').eq('workspace_id', workspaceId).eq('status', 'planned').order('planned_date'),
      supabase.rpc('get_account_balances', { p_workspace_id: workspaceId }),
    ]);
    if (plansResult.error || balancesResult.error) setError(plansResult.error?.message || balancesResult.error?.message || 'Ошибка прогноза');
    setPlans(plansResult.data || []);
    setOpeningBalance((balancesResult.data || []).reduce((sum, row) => sum + Number(row.base_balance || 0), 0));
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  const range = useMemo(() => ({ from: today(), to: addDays(today(), horizon) }), [horizon]);
  const forecast = useMemo(() => {
    const planEvents = plans.filter((plan) => plan.planned_date >= range.from && plan.planned_date <= range.to).map((plan) => ({
      id: `plan:${plan.id}`, source: 'plan', sourceId: plan.id, date: plan.planned_date,
      title: plan.title, direction: plan.direction, amount: Number(plan.base_amount), currency: plan.currency,
    }));
    const scheduledEvents = expandScheduled(scheduledItems, range.from, range.to, (amount, currency, date) => {
      if (!currency || currency === currencyCode) return amount;
      return amount * (Number(getRate(currency, currencyCode, date)) || 1);
    });
    const debtEvents = activeDebts.filter((debt) => debt.due_on && debt.due_on <= range.to).map((debt) => {
      const rate = debt.currency === currencyCode ? 1 : Number(getRate(debt.currency, currencyCode, debt.due_on)) || 1;
      return {
        id: `debt:${debt.id}`, source: 'debt', sourceId: debt.id, date: getDebtForecastDate(debt.due_on, range.from),
        title: `${debt.title} · ${debt.counterparty}`, direction: debt.direction === 'owed_to_me' ? 'income' : 'expense',
        amount: Number(debt.remaining_amount) * rate, currency: debt.currency,
      };
    });
    return buildCashflowForecast({ openingBalance, plans: planEvents, scheduled: scheduledEvents, debts: debtEvents });
  }, [activeDebts, currencyCode, getRate, openingBalance, plans, range, scheduledItems]);

  const formCategories = categories.filter((category) => !category.is_archived && category.type === form.direction);

  const savePlan = async (event) => {
    event.preventDefault();
    const account = accountMap.get(form.account_id);
    const amount = Number(form.amount);
    if (!form.title.trim() || !account || !(amount > 0)) return;
    const rate = account.currency === currencyCode ? 1 : Number(getRate(account.currency, currencyCode, form.planned_date));
    if (!(rate > 0)) { setError(`Нет курса ${account.currency} → ${currencyCode} на выбранную дату`); return; }
    setSaving(true);
    const { data: auth } = await supabase.auth.getUser();
    const { error: insertError } = await supabase.from('cashflow_plans').insert({
      workspace_id: workspaceId, created_by: auth.user.id, title: form.title.trim(), direction: form.direction,
      amount, currency: account.currency, exchange_rate: rate, base_amount: Math.round(amount * rate * 100) / 100,
      planned_date: form.planned_date, account_id: account.id, category_id: form.category_id || null, notes: form.notes || null,
    });
    setSaving(false);
    if (insertError) { setError(insertError.message); return; }
    setForm({ title: '', direction: 'expense', amount: '', planned_date: today(), account_id: defaultAccount?.id || '', category_id: '', notes: '' });
    setShowForm(false);
    await load();
  };

  const completePlan = async (id) => {
    const { error: completeError } = await supabase.rpc('complete_cashflow_plan', { p_plan_id: id });
    if (completeError) setError(completeError.message); else await load();
  };
  const cancelPlan = async (id) => {
    const { error: cancelError } = await supabase.from('cashflow_plans').update({ status: 'cancelled' }).eq('id', id).eq('workspace_id', workspaceId);
    if (cancelError) setError(cancelError.message); else await load();
  };

  return (
    <div className="mx-auto max-w-3xl p-4 pb-24 sm:p-6" data-testid="cashflow-page">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-primary-600">Контроль денег</p><h1 className="text-2xl font-bold text-gray-950 dark:text-white">Платёжный календарь</h1><p className="mt-1 text-sm text-gray-500">Планы, регулярные платежи и долги в одном прогнозе</p></div>
        {canCreateOperations && <button onClick={() => setShowForm(true)} aria-label="Добавить плановый платёж" className="btn-primary flex min-h-11 shrink-0 items-center gap-2"><Plus size={17} /> <span className="hidden sm:inline">Платёж</span></button>}
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2">{[30, 60, 90].map((days) => <button key={days} onClick={() => setHorizon(days)} className={`min-h-11 rounded-xl border text-sm font-medium ${horizon === days ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'}`}>{days} дней</button>)}</div>
      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
      {forecast.firstGapDate && <div className="mb-4 flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"><AlertTriangle className="shrink-0" /><div><p className="font-semibold">Возможен кассовый разрыв {new Date(`${forecast.firstGapDate}T12:00:00`).toLocaleDateString('ru-RU')}</p><p className="text-sm">Минимальный остаток: {formatBalance(forecast.minimumBalance, currencySymbol)}</p></div></div>}

      <section className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[['Сейчас', openingBalance, 'text-gray-900 dark:text-white', true], ['Поступления', forecast.totalIncome, 'text-green-600'], ['Платежи', forecast.totalExpense, 'text-red-600'], ['Через период', forecast.closingBalance, forecast.closingBalance >= 0 ? 'text-primary-600' : 'text-red-600', true]].map(([label, value, color, signed]) => <div key={label} className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800"><p className="text-xs text-gray-500">{label}</p><p className={`mt-1 font-semibold tabular-nums ${color}`}>{signed ? formatBalance(value, currencySymbol) : formatUnsignedAmount(value, currencySymbol)}</p></div>)}
      </section>

      {showForm && <form onSubmit={savePlan} className="mb-5 space-y-3 rounded-2xl border border-primary-200 bg-white p-4 shadow-sm dark:border-primary-800 dark:bg-gray-800">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Новый плановый платёж</h2><button type="button" onClick={() => setShowForm(false)} className="grid min-h-11 min-w-11 place-items-center" aria-label="Закрыть форму"><X size={18} /></button></div>
        <input className="input-field" placeholder="Например: Оплата поставщику" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
        <div className="grid gap-2 sm:grid-cols-2"><select className="input-field" value={form.direction} onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value, category_id: '' }))}><option value="expense">Расход</option><option value="income">Доход</option></select><input type="date" className="input-field" value={form.planned_date} onChange={(e) => setForm((f) => ({ ...f, planned_date: e.target.value }))} required /></div>
        <div className="grid gap-2 sm:grid-cols-2"><input type="number" min="0.01" step="0.01" className="input-field" placeholder="Сумма" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} required /><select className="input-field" value={form.account_id} onChange={(e) => setForm((f) => ({ ...f, account_id: e.target.value }))} required><option value="">Выберите счёт</option>{activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></div>
        <select className="input-field" value={form.category_id} onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}><option value="">Без категории</option>{formCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
        <button disabled={saving} className="btn-primary min-h-11 w-full">{saving ? 'Сохраняем…' : 'Добавить в календарь'}</button>
      </form>}

      <section className="space-y-3">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Ближайшие события</h2>
        {loading ? <p className="text-sm text-gray-500">Загрузка прогноза…</p> : forecast.timeline.length === 0 ? <p className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700">На выбранный период платежей нет.</p> : forecast.timeline.map((event) => (
          <article key={event.id} className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">{SOURCE_LABELS[event.source]}</span><time className="text-xs text-gray-500">{new Date(`${event.date}T12:00:00`).toLocaleDateString('ru-RU')}</time></div><p className="mt-1 truncate font-medium">{event.title}</p><p className="mt-1 text-xs text-gray-500">Остаток после события: {formatBalance(event.projectedBalance, currencySymbol)}</p></div><p className={`shrink-0 font-semibold tabular-nums ${event.direction === 'income' ? 'text-green-600' : 'text-red-600'}`}>{event.direction === 'income' ? '+' : '−'}{formatUnsignedAmount(event.amount, currencySymbol)}</p></div>
            {event.source === 'plan' && canCreateOperations && <div className="mt-3 flex justify-end gap-2 border-t border-gray-100 pt-2 dark:border-gray-700"><button onClick={() => cancelPlan(event.sourceId)} className="btn-secondary min-h-10 px-3 text-sm">Отменить</button><button onClick={() => completePlan(event.sourceId)} className="btn-primary flex min-h-10 items-center gap-1.5 px-3 text-sm"><CheckCircle2 size={15} /> Провести</button></div>}
          </article>
        ))}
      </section>
    </div>
  );
}
