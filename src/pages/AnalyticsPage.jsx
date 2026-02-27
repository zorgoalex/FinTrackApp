import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useWorkspace } from '../contexts/WorkspaceContext';
import useAnalytics from '../hooks/useAnalytics';
import { formatUnsignedAmount } from '../utils/formatters';
import { getMonthRange, formatMonthYear } from '../utils/dateRange';
import { startOfYear, endOfYear, subMonths, format } from 'date-fns';
import { ru } from 'date-fns/locale';

const PERIODS = [
  { key: 'current', label: 'Текущий месяц' },
  { key: 'prev', label: 'Прошлый месяц' },
  { key: 'quarter', label: 'Квартал' },
  { key: 'year', label: 'Год' },
  { key: 'custom', label: 'Произвольный' },
];

function getPeriodDates(periodKey) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  switch (periodKey) {
    case 'current':
      return getMonthRange(y, m);
    case 'prev': {
      const prev = subMonths(now, 1);
      return getMonthRange(prev.getFullYear(), prev.getMonth());
    }
    case 'quarter': {
      const qStart = new Date(y, Math.floor(m / 3) * 3, 1);
      const qEnd = new Date(y, Math.floor(m / 3) * 3 + 3, 0);
      return {
        dateFrom: format(qStart, 'yyyy-MM-dd'),
        dateTo: format(qEnd, 'yyyy-MM-dd'),
      };
    }
    case 'year':
      return {
        dateFrom: format(startOfYear(now), 'yyyy-MM-dd'),
        dateTo: format(endOfYear(now), 'yyyy-MM-dd'),
      };
    default:
      return getMonthRange(y, m);
  }
}

export default function AnalyticsPage() {
  const [searchParams] = useSearchParams();
  const { workspaceId: wsFromCtx } = useWorkspace();
  const workspaceId = searchParams.get('workspaceId') || wsFromCtx;

  const [period, setPeriod] = useState('current');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [breakdownTab, setBreakdownTab] = useState('categories');

  const { dateFrom, dateTo } = useMemo(() => {
    if (period === 'custom' && customFrom && customTo) {
      return { dateFrom: customFrom, dateTo: customTo };
    }
    return getPeriodDates(period);
  }, [period, customFrom, customTo]);

  const { analytics, loading, error } = useAnalytics(workspaceId, { dateFrom, dateTo });

  if (!workspaceId) {
    return (
      <div className="max-w-3xl mx-auto p-4 text-center text-gray-500">
        Выберите рабочее пространство.
      </div>
    );
  }

  const { totalIncome, totalExpense, totalSalary, balance, categoryBreakdown, tagBreakdown, operationCount } = analytics;
  const maxCategoryAmount = Math.max(...categoryBreakdown.map(c => c.amount), 1);
  const maxTagAmount = Math.max(...tagBreakdown.map(t => t.amount), 1);

  return (
    <div className="max-w-3xl mx-auto p-4 pb-24" data-testid="analytics-page">
      <h1 className="text-xl font-semibold text-gray-900 mb-4">Аналитика</h1>

      {/* Period selector */}
      <div className="flex flex-wrap gap-2 mb-4" data-testid="period-selector">
        {PERIODS.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              period === p.key
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Custom date range inputs */}
      {period === 'custom' && (
        <div className="flex gap-2 mb-4">
          <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
            className="input-field text-sm" />
          <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
            className="input-field text-sm" />
        </div>
      )}

      {/* Period info */}
      <p className="text-sm text-gray-500 mb-4">
        Период: {dateFrom} — {dateTo} · {operationCount} операций
      </p>

      {loading && (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-3 text-gray-500">Загрузка...</p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 mb-4">{error}</div>
      )}

      {!loading && !error && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6" data-testid="summary-cards">
            <SummaryCard label="Доходы" amount={totalIncome} color="text-green-600" bg="bg-green-50" />
            <SummaryCard label="Расходы" amount={totalExpense} color="text-red-600" bg="bg-red-50" />
            <SummaryCard label="Зарплаты" amount={totalSalary} color="text-blue-600" bg="bg-blue-50" />
            <SummaryCard label="Баланс" amount={balance} color={balance >= 0 ? 'text-green-700' : 'text-red-700'} bg="bg-gray-50" />
          </div>

          {/* Breakdown tabs (mobile) */}
          <div className="flex border-b border-gray-200 mb-4">
            <button
              onClick={() => setBreakdownTab('categories')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                breakdownTab === 'categories' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              По категориям
            </button>
            <button
              onClick={() => setBreakdownTab('tags')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                breakdownTab === 'tags' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              По тегам
            </button>
          </div>

          {breakdownTab === 'categories' ? (
            <BreakdownTable items={categoryBreakdown} maxAmount={maxCategoryAmount} emptyText="Нет данных по категориям" />
          ) : (
            <BreakdownTable items={tagBreakdown} maxAmount={maxTagAmount} emptyText="Нет данных по тегам" />
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, amount, color, bg }) {
  return (
    <div className={`${bg} rounded-lg p-3 border border-gray-100`}>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-lg font-semibold ${color}`}>{formatUnsignedAmount(amount)}</p>
    </div>
  );
}

function BreakdownTable({ items, maxAmount, emptyText }) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-500 text-center py-4">{emptyText}</p>;
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 divide-y divide-gray-100">
      {items.map((item, i) => (
        <div key={item.categoryId || item.tagId || i} className="px-4 py-3">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
              <span className="text-sm font-medium text-gray-900">{item.name}</span>
              <span className="text-xs text-gray-400">{item.count} оп.</span>
            </div>
            <span className="text-sm font-semibold text-gray-900">{formatUnsignedAmount(item.amount)}</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div
              className="h-2 rounded-full transition-all"
              style={{
                width: `${Math.round((item.amount / maxAmount) * 100)}%`,
                backgroundColor: item.color,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
