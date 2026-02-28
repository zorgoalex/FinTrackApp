import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useWorkspace } from '../contexts/WorkspaceContext';
import useAnalytics from '../hooks/useAnalytics';
import { formatUnsignedAmount } from '../utils/formatters';
import { getMonthRange, formatMonthYear } from '../utils/dateRange';
import { startOfYear, endOfYear, subMonths, format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { exportToCSV, buildTextReport } from '../utils/export';
import { Download, Copy } from 'lucide-react';

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
  const { workspaceId: wsFromCtx, allWorkspaces } = useWorkspace();
  const workspaceId = searchParams.get('workspaceId') || wsFromCtx;

  const [selectedWsIds, setSelectedWsIds] = useState([workspaceId]);
  const [period, setPeriod] = useState('current');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [breakdownTab, setBreakdownTab] = useState('categories');
  const [copied, setCopied] = useState(false);

  // Reset selection when active workspace changes
  useEffect(() => {
    setSelectedWsIds([workspaceId]);
  }, [workspaceId]);

  const showMultiselect = allWorkspaces && allWorkspaces.length > 1;

  const toggleWs = (id) => {
    setSelectedWsIds(prev => {
      if (prev.includes(id)) {
        // Don't allow deselecting all
        if (prev.length === 1) return prev;
        return prev.filter(x => x !== id);
      }
      return [...prev, id];
    });
  };

  const toggleAll = () => {
    const allIds = allWorkspaces.map(w => w.id);
    const allSelected = allIds.every(id => selectedWsIds.includes(id));
    setSelectedWsIds(allSelected ? [workspaceId] : allIds);
  };

  const { dateFrom, dateTo } = useMemo(() => {
    if (period === 'custom' && customFrom && customTo) {
      return { dateFrom: customFrom, dateTo: customTo };
    }
    return getPeriodDates(period);
  }, [period, customFrom, customTo]);

  const { analytics, loading, error } = useAnalytics(selectedWsIds, { dateFrom, dateTo });

  if (!workspaceId) {
    return (
      <div className="max-w-2xl mx-auto p-4 text-center text-gray-500 dark:text-gray-400">
        Выберите рабочее пространство.
      </div>
    );
  }

  const { totalIncome, totalExpense, totalSalary, balance, categoryBreakdown, tagBreakdown, operationCount } = analytics;
  const maxCategoryAmount = Math.max(...categoryBreakdown.map(c => c.amount), 1);
  const maxTagAmount = Math.max(...tagBreakdown.map(t => t.amount), 1);

  const handleExportCSV = () => {
    exportToCSV(analytics, dateFrom, dateTo);
  };

  const handleCopyReport = async () => {
    const text = buildTextReport(analytics, dateFrom, dateTo);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-4 pb-24" data-testid="analytics-page">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">Аналитика</h1>

      {/* Workspace multiselect */}
      {showMultiselect && (
        <div className="flex flex-wrap items-center gap-2 mb-4" data-testid="workspace-multiselect">
          <button
            onClick={toggleAll}
            aria-pressed={allWorkspaces.every(w => selectedWsIds.includes(w.id))}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              allWorkspaces.every(w => selectedWsIds.includes(w.id))
                ? 'bg-primary-600 dark:bg-primary-500 text-white border-primary-600 dark:border-primary-500'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-primary-400'
            }`}
          >
            Все
          </button>
          {allWorkspaces.map(ws => (
            <button
              key={ws.id}
              onClick={() => toggleWs(ws.id)}
              aria-pressed={selectedWsIds.includes(ws.id)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                selectedWsIds.includes(ws.id)
                  ? 'bg-primary-600 dark:bg-primary-500 text-white border-primary-600 dark:border-primary-500'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-primary-400'
              }`}
            >
              {ws.name}
            </button>
          ))}
          {allWorkspaces.length > 2 && (
            <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">
              {selectedWsIds.length} из {allWorkspaces.length}
            </span>
          )}
        </div>
      )}

      {/* Period selector */}
      <div className="flex flex-wrap gap-2 mb-4" data-testid="period-selector">
        {PERIODS.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              period === p.key
                ? 'bg-primary-600 dark:bg-primary-500 text-white border-primary-600 dark:border-primary-500'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-primary-400'
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
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Период: {dateFrom} — {dateTo} · {operationCount} операций
      </p>

      {loading && (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 dark:border-primary-400 mx-auto"></div>
          <p className="mt-3 text-gray-500 dark:text-gray-400">Загрузка...</p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl p-3 text-sm text-red-700 dark:text-red-400 mb-4">{error}</div>
      )}

      {!loading && !error && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6" data-testid="summary-cards">
            <SummaryCard label="Доходы" amount={totalIncome} color="text-green-600" bg="bg-green-50 dark:bg-green-900/30" />
            <SummaryCard label="Расходы" amount={totalExpense} color="text-red-600" bg="bg-red-50 dark:bg-red-900/30" />
            <SummaryCard label="Зарплаты" amount={totalSalary} color="text-primary-600 dark:text-primary-400" bg="bg-primary-50 dark:bg-primary-900/30" />
            <SummaryCard label="Баланс" amount={balance} color={balance >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'} bg="bg-gray-50 dark:bg-gray-800" />
          </div>

          {/* Breakdown tabs (mobile) */}
          <div className="flex border-b border-gray-200 dark:border-gray-700 mb-4">
            <button
              onClick={() => setBreakdownTab('categories')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                breakdownTab === 'categories' ? 'border-primary-600 dark:border-primary-400 text-primary-600 dark:text-primary-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              По категориям
            </button>
            <button
              onClick={() => setBreakdownTab('tags')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                breakdownTab === 'tags' ? 'border-primary-600 dark:border-primary-400 text-primary-600 dark:text-primary-400' : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
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

          {/* Export buttons */}
          <div className="flex gap-2 mt-6" data-testid="export-buttons">
            <button
              onClick={handleExportCSV}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/50 text-sm font-medium transition-colors"
              data-testid="export-csv"
            >
              <Download size={16} />
              Скачать CSV
            </button>
            <button
              onClick={handleCopyReport}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 border border-primary-200 dark:border-primary-800 hover:bg-primary-100 dark:hover:bg-primary-900/50 text-sm font-medium transition-colors"
              data-testid="export-copy"
            >
              <Copy size={16} />
              {copied ? 'Скопировано!' : 'Копировать отчёт'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, amount, color, bg }) {
  return (
    <div className={`${bg} rounded-xl p-3 border border-gray-100 dark:border-gray-700`}>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${color}`}>{formatUnsignedAmount(amount)}</p>
    </div>
  );
}

function BreakdownTable({ items, maxAmount, emptyText }) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">{emptyText}</p>;
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
      {items.map((item, i) => (
        <div key={item.categoryId || item.tagId || i} className="px-4 py-3">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.name}</span>
              <span className="text-xs text-gray-400 dark:text-gray-500">{item.count} оп.</span>
            </div>
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{formatUnsignedAmount(item.amount)}</span>
          </div>
          <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2">
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
