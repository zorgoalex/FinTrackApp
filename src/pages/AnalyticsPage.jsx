import { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useWorkspace } from '../contexts/WorkspaceContext';
import useAnalytics from '../hooks/useAnalytics';
import { formatUnsignedAmount } from '../utils/formatters';
import { getMonthRange, formatMonthYear } from '../utils/dateRange';
import { startOfYear, endOfYear, addMonths, subMonths, addYears, subYears, format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { exportToCSV, buildTextReport } from '../utils/export';
import { Download, Copy, ChevronDown, Check } from 'lucide-react';

const PERIODS = [
  { key: 'month', label: '1м', title: 'Месяц' },
  { key: 'quarter', label: '1к', title: 'Квартал' },
  { key: 'year', label: '1г', title: 'Год' },
  { key: 'custom', label: 'Произвольный', title: 'Произвольный период' },
];

function getPeriodDates(periodKey, offset) {
  const base = new Date();

  switch (periodKey) {
    case 'month': {
      const d = offset > 0 ? addMonths(base, offset) : offset < 0 ? subMonths(base, -offset) : base;
      return getMonthRange(d.getFullYear(), d.getMonth());
    }
    case 'quarter': {
      const shifted = offset > 0 ? addMonths(base, offset * 3) : offset < 0 ? subMonths(base, -offset * 3) : base;
      const y = shifted.getFullYear();
      const m = shifted.getMonth();
      const qStart = new Date(y, Math.floor(m / 3) * 3, 1);
      const qEnd = new Date(y, Math.floor(m / 3) * 3 + 3, 0);
      return {
        dateFrom: format(qStart, 'yyyy-MM-dd'),
        dateTo: format(qEnd, 'yyyy-MM-dd'),
      };
    }
    case 'year': {
      const d = offset > 0 ? addYears(base, offset) : offset < 0 ? subYears(base, -offset) : base;
      return {
        dateFrom: format(startOfYear(d), 'yyyy-MM-dd'),
        dateTo: format(endOfYear(d), 'yyyy-MM-dd'),
      };
    }
    default:
      return getMonthRange(base.getFullYear(), base.getMonth());
  }
}

export default function AnalyticsPage() {
  const [searchParams] = useSearchParams();
  const { workspaceId: wsFromCtx, allWorkspaces } = useWorkspace();
  const workspaceId = searchParams.get('workspaceId') || wsFromCtx;

  const [selectedWsIds, setSelectedWsIds] = useState([workspaceId]);
  const [wsDropdownOpen, setWsDropdownOpen] = useState(false);
  const wsDropdownRef = useRef(null);
  const [period, setPeriod] = useState('month');
  const [periodOffset, setPeriodOffset] = useState(0);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [breakdownTab, setBreakdownTab] = useState('categories');
  const [copied, setCopied] = useState(false);

  // Reset selection when active workspace changes
  useEffect(() => {
    setSelectedWsIds([workspaceId]);
  }, [workspaceId]);

  // Reset offset when period type changes
  const handlePeriodChange = (key) => {
    setPeriod(key);
    setPeriodOffset(0);
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wsDropdownRef.current && !wsDropdownRef.current.contains(e.target)) {
        setWsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const showMultiselect = allWorkspaces && allWorkspaces.length > 1;

  const toggleWs = (id) => {
    setSelectedWsIds(prev => {
      if (prev.includes(id)) {
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

  const wsDropdownLabel = useMemo(() => {
    if (!allWorkspaces || allWorkspaces.length <= 1) return '';
    const allIds = allWorkspaces.map(w => w.id);
    if (allIds.every(id => selectedWsIds.includes(id))) return 'Все пространства';
    if (selectedWsIds.length === 1) {
      const ws = allWorkspaces.find(w => w.id === selectedWsIds[0]);
      return ws?.name || 'Пространство';
    }
    return `${selectedWsIds.length} из ${allWorkspaces.length}`;
  }, [selectedWsIds, allWorkspaces]);

  const { dateFrom, dateTo } = useMemo(() => {
    if (period === 'custom' && customFrom && customTo) {
      return { dateFrom: customFrom, dateTo: customTo };
    }
    return getPeriodDates(period, periodOffset);
  }, [period, periodOffset, customFrom, customTo]);

  const { analytics, loading, error } = useAnalytics(selectedWsIds, { dateFrom, dateTo });

  if (!workspaceId) {
    return (
      <div className="max-w-2xl mx-auto p-4 text-center text-gray-500 dark:text-gray-400">
        Выберите рабочее пространство.
      </div>
    );
  }

  const { totalIncome, totalExpense, balance, categoryBreakdown, tagBreakdown, operationCount } = analytics;
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

      {/* Controls row: workspace dropdown + period selector */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        {/* Workspace dropdown multiselect */}
        {showMultiselect && (
          <div className="relative" ref={wsDropdownRef} data-testid="workspace-multiselect">
            <button
              onClick={() => setWsDropdownOpen(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-primary-400 transition-colors"
            >
              {wsDropdownLabel}
              <ChevronDown size={14} className={`transition-transform ${wsDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {wsDropdownOpen && (
              <div className="absolute z-20 mt-1 left-0 min-w-[200px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1">
                <button
                  onClick={toggleAll}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                >
                  <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                    allWorkspaces.every(w => selectedWsIds.includes(w.id))
                      ? 'bg-primary-600 dark:bg-primary-500 border-primary-600 dark:border-primary-500'
                      : 'border-gray-300 dark:border-gray-600'
                  }`}>
                    {allWorkspaces.every(w => selectedWsIds.includes(w.id)) && <Check size={12} className="text-white" />}
                  </span>
                  Все пространства
                </button>
                <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
                {allWorkspaces.map(ws => (
                  <button
                    key={ws.id}
                    onClick={() => toggleWs(ws.id)}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                  >
                    <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                      selectedWsIds.includes(ws.id)
                        ? 'bg-primary-600 dark:bg-primary-500 border-primary-600 dark:border-primary-500'
                        : 'border-gray-300 dark:border-gray-600'
                    }`}>
                      {selectedWsIds.includes(ws.id) && <Check size={12} className="text-white" />}
                    </span>
                    {ws.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Period selector with prev/next arrows */}
        <div className="flex items-center gap-1" data-testid="period-selector">
          {PERIODS.map(p => (
            <div key={p.key} className="flex items-center">
              {period === p.key && p.key !== 'custom' && (
                <button
                  onClick={() => setPeriodOffset(o => o - 1)}
                  className="p-1 text-gray-400 dark:text-gray-500 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                  aria-label="Предыдущий период"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><polygon points="8,1 8,11 2,6" /></svg>
                </button>
              )}
              <button
                onClick={() => handlePeriodChange(p.key)}
                title={p.title}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  period === p.key
                    ? 'bg-primary-600 dark:bg-primary-500 text-white border-primary-600 dark:border-primary-500'
                    : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-primary-400'
                }`}
              >
                {p.label}
              </button>
              {period === p.key && p.key !== 'custom' && (
                <button
                  onClick={() => setPeriodOffset(o => o + 1)}
                  className="p-1 text-gray-400 dark:text-gray-500 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                  aria-label="Следующий период"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><polygon points="4,1 4,11 10,6" /></svg>
                </button>
              )}
            </div>
          ))}
        </div>
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
          {/* Summary cards — 3 in one row */}
          <div className="grid grid-cols-3 gap-2 mb-6" data-testid="summary-cards">
            <SummaryCard label="Доходы" amount={totalIncome} color="text-green-600" bg="bg-green-50 dark:bg-green-900/30" />
            <SummaryCard label="Расходы" amount={totalExpense} color="text-red-600" bg="bg-red-50 dark:bg-red-900/30" />
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
    <div className={`${bg} rounded-xl px-3 py-2 border border-gray-100 dark:border-gray-700 flex items-center gap-1.5 min-w-0`}>
      <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{label}</span>
      <span className={`text-sm font-semibold tabular-nums truncate ${color}`}>{formatUnsignedAmount(amount)}</span>
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
