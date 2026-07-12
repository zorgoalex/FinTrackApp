import { useMemo, useState } from 'react';
import { Archive, Building2, Edit3, Landmark, Plus, Target, TrendingUp } from 'lucide-react';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { usePermissions } from '../hooks/usePermissions';
import useNetWorth from '../hooks/useNetWorth';
import { formatBalance, formatUnsignedAmount } from '../utils/formatters';

const categories = {
  asset: [
    ['real_estate', 'Недвижимость'], ['vehicle', 'Транспорт'], ['investment', 'Инвестиции'],
    ['equipment', 'Оборудование'], ['receivable', 'Дебиторская задолженность'], ['other_asset', 'Другой актив'],
  ],
  liability: [
    ['mortgage', 'Ипотека'], ['loan', 'Кредит'], ['credit_card', 'Кредитная карта'],
    ['tax', 'Налоги'], ['payable', 'Кредиторская задолженность'], ['other_liability', 'Другое обязательство'],
  ],
};

const emptyItem = (baseCurrency) => ({
  kind: 'asset', category: 'real_estate', name: '', description: '', currency: baseCurrency,
  current_value: '', exchange_rate: 1, valued_on: new Date().toISOString().slice(0, 10), is_archived: false,
});

export default function AssetsPage() {
  const { workspaceId, currencyCode, currencySymbol } = useWorkspace();
  const { hasManagementRights } = usePermissions();
  const netWorth = useNetWorth(workspaceId);
  const [editing, setEditing] = useState(null);
  const [goalFormOpen, setGoalFormOpen] = useState(false);
  const [goalDraft, setGoalDraft] = useState({ name: 'Целевой капитал', target_amount: '', target_date: '' });

  const activeItems = useMemo(() => netWorth.items.filter((item) => !item.is_archived), [netWorth.items]);
  const activeGoal = netWorth.goals.find((goal) => goal.status === 'active');
  const goalProgress = activeGoal && netWorth.report
    ? Math.max(0, Math.min(100, netWorth.report.net_worth / activeGoal.target_amount * 100)) : 0;
  const maxHistory = Math.max(1, ...netWorth.history.map((point) => Math.abs(point.net_worth)));

  const startCreate = (kind) => setEditing({
    ...emptyItem(currencyCode), kind, category: categories[kind][0][0],
  });

  const submitItem = async (event) => {
    event.preventDefault();
    if (await netWorth.saveItem(editing)) setEditing(null);
  };

  const submitGoal = async (event) => {
    event.preventDefault();
    if (await netWorth.saveGoal({ ...goalDraft, id: activeGoal?.id })) setGoalFormOpen(false);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 lg:px-8 lg:py-7">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-600 dark:text-primary-400">Финансовая позиция</p>
          <h1 className="mt-2 text-3xl font-bold text-gray-950 dark:text-white">Активы и капитал</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Денежные счета, имущество, инвестиции и обязательства в базовой валюте.</p>
        </div>
        {hasManagementRights && <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => startCreate('liability')}><Plus size={16} className="mr-1" />Обязательство</button>
          <button className="btn-primary" onClick={() => startCreate('asset')}><Plus size={16} className="mr-1" />Актив</button>
        </div>}
      </header>

      {netWorth.error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">{netWorth.error}</div>}

      <section className="grid gap-4 sm:grid-cols-3">
        <Metric icon={Landmark} label="Чистый капитал" value={formatBalance(netWorth.report?.net_worth || 0, currencySymbol)} emphasized />
        <Metric icon={TrendingUp} label="Все активы" value={formatUnsignedAmount(netWorth.report?.total_assets || 0, currencySymbol)} tone="green" />
        <Metric icon={Building2} label="Все обязательства" value={formatUnsignedAmount(netWorth.report?.total_liabilities || 0, currencySymbol)} tone="red" />
      </section>

      <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="card">
          <div className="mb-4 flex items-center justify-between">
            <div><h2 className="font-semibold text-gray-900 dark:text-white">Динамика за 12 месяцев</h2><p className="text-xs text-gray-500">Оценка на начало каждого месяца</p></div>
          </div>
          {netWorth.history.length ? <div className="flex h-40 items-end gap-2" aria-label="График чистого капитала">
            {netWorth.history.map((point) => <div key={point.period_start} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <span className="hidden text-[10px] text-gray-500 group-hover:block">{formatUnsignedAmount(point.net_worth, currencySymbol)}</span>
              <div className={`w-full rounded-t ${point.net_worth >= 0 ? 'bg-primary-500' : 'bg-red-500'}`} style={{ height: `${Math.max(4, Math.abs(point.net_worth) / maxHistory * 120)}px` }} />
              <span className="text-[9px] text-gray-400">{point.period_start.slice(5, 7)}</span>
            </div>)}
          </div> : <p className="py-12 text-center text-sm text-gray-500">История появится после первой оценки.</p>}
        </div>

        <div className="card">
          <div className="flex items-center justify-between"><h2 className="font-semibold text-gray-900 dark:text-white">Цель капитала</h2>{hasManagementRights && <button onClick={() => { setGoalDraft(activeGoal || goalDraft); setGoalFormOpen(true); }} className="text-primary-600"><Edit3 size={16} /></button>}</div>
          {activeGoal ? <div className="mt-5">
            <div className="flex justify-between text-sm"><span>{activeGoal.name}</span><span>{Math.round(goalProgress)}%</span></div>
            <div className="mt-2 h-2 rounded-full bg-gray-200 dark:bg-gray-700"><div className="h-2 rounded-full bg-primary-500" style={{ width: `${goalProgress}%` }} /></div>
            <p className="mt-3 text-sm text-gray-500">{formatUnsignedAmount(netWorth.report?.net_worth || 0, currencySymbol)} из {formatUnsignedAmount(activeGoal.target_amount, currencySymbol)}</p>
          </div> : <button disabled={!hasManagementRights} onClick={() => setGoalFormOpen(true)} className="mt-6 flex w-full flex-col items-center rounded-xl border border-dashed border-gray-300 p-5 text-sm text-gray-500 disabled:opacity-60 dark:border-gray-700"><Target className="mb-2" />Задать цель</button>}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {['asset', 'liability'].map((kind) => <ItemList key={kind} kind={kind} items={activeItems.filter((item) => item.kind === kind)} currencySymbol={currencySymbol} canEdit={hasManagementRights} onEdit={setEditing} onArchive={netWorth.archiveItem} />)}
      </section>

      {editing && <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true">
        <form onSubmit={submitItem} className="card w-full max-w-lg space-y-4">
          <h2 className="text-xl font-semibold dark:text-white">{editing.id ? 'Изменить' : 'Добавить'} {editing.kind === 'asset' ? 'актив' : 'обязательство'}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">Название<input required className="input mt-1 w-full" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
            <label className="text-sm">Категория<select className="input mt-1 w-full" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>{categories[editing.kind].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="text-sm">Стоимость<input required min="0" step="0.01" type="number" className="input mt-1 w-full" value={editing.current_value} onChange={(e) => setEditing({ ...editing, current_value: e.target.value })} /></label>
            <label className="text-sm">Валюта<select className="input mt-1 w-full" value={editing.currency} onChange={(e) => setEditing({ ...editing, currency: e.target.value, exchange_rate: e.target.value === currencyCode ? 1 : editing.exchange_rate })}>{['KZT','RUB','USD','EUR'].map((code) => <option key={code}>{code}</option>)}</select></label>
            {editing.currency !== currencyCode && <label className="text-sm">Курс к {currencyCode}<input required min="0.0000001" step="any" type="number" className="input mt-1 w-full" value={editing.exchange_rate} onChange={(e) => setEditing({ ...editing, exchange_rate: e.target.value })} /></label>}
            <label className="text-sm">Дата оценки<input required type="date" className="input mt-1 w-full" value={editing.valued_on} onChange={(e) => setEditing({ ...editing, valued_on: e.target.value })} /></label>
          </div>
          <label className="text-sm">Комментарий<textarea className="input mt-1 w-full" rows="2" value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></label>
          <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Отмена</button><button className="btn-primary">Сохранить</button></div>
        </form>
      </div>}

      {goalFormOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"><form onSubmit={submitGoal} className="card w-full max-w-md space-y-4"><h2 className="text-xl font-semibold dark:text-white">Цель капитала</h2><label className="text-sm">Название<input required className="input mt-1 w-full" value={goalDraft.name} onChange={(e) => setGoalDraft({ ...goalDraft, name: e.target.value })} /></label><label className="text-sm">Целевая сумма<input required min="0.01" step="0.01" type="number" className="input mt-1 w-full" value={goalDraft.target_amount} onChange={(e) => setGoalDraft({ ...goalDraft, target_amount: e.target.value })} /></label><label className="text-sm">Целевая дата<input type="date" className="input mt-1 w-full" value={goalDraft.target_date || ''} onChange={(e) => setGoalDraft({ ...goalDraft, target_date: e.target.value })} /></label><div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setGoalFormOpen(false)}>Отмена</button><button className="btn-primary">Сохранить</button></div></form></div>}
    </div>
  );
}

function Metric({ icon: Icon, label, value, tone, emphasized }) {
  const color = tone === 'green' ? 'text-green-600 dark:text-green-400' : tone === 'red' ? 'text-red-600 dark:text-red-400' : 'text-primary-600 dark:text-primary-400';
  return <div className={`card ${emphasized ? 'ring-1 ring-primary-200 dark:ring-primary-800' : ''}`}><div className="flex items-center gap-2 text-sm text-gray-500"><Icon size={17} />{label}</div><p className={`mt-2 text-2xl font-bold tabular-nums ${color}`}>{value}</p></div>;
}

function ItemList({ kind, items, currencySymbol, canEdit, onEdit, onArchive }) {
  return <div className="card"><h2 className="mb-3 font-semibold text-gray-900 dark:text-white">{kind === 'asset' ? 'Активы' : 'Обязательства'}</h2>{items.length ? <div className="divide-y divide-gray-100 dark:divide-gray-700">{items.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="truncate font-medium text-gray-800 dark:text-gray-200">{item.name}</p><p className="text-xs text-gray-500">Оценка на {item.valued_on} · {item.currency}</p></div><div className="flex items-center gap-2"><span className="whitespace-nowrap font-semibold tabular-nums">{formatUnsignedAmount(item.current_base_value, currencySymbol)}</span>{canEdit && <><button onClick={() => onEdit({ ...item })} aria-label="Изменить"><Edit3 size={15} /></button><button onClick={() => onArchive(item.id)} aria-label="Архивировать"><Archive size={15} /></button></>}</div></div>)}</div> : <p className="py-8 text-center text-sm text-gray-500">Пока пусто</p>}</div>;
}
