import { useMemo, useState, useCallback, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useWorkspace } from '../contexts/WorkspaceContext';
import useOperations from '../hooks/useOperations';
import { usePermissions } from '../hooks/usePermissions';
import useAccounts from '../hooks/useAccounts';
import AddOperationModal from '../components/AddOperationModal';
import QuickButtonsSettings from '../components/QuickButtonsSettings';
import { Plus, BarChart3, TrendingUp, FileText, Pin, Minimize2, Maximize2, Wallet, Settings, Receipt, Eye, EyeOff } from 'lucide-react';
import { formatUnsignedAmount, formatSignedAmount as formatBalance } from '../utils/formatters';
import useCategories from '../hooks/useCategories';
import useDebts from '../hooks/useDebts';

function formatSignedAmount(value) {
  return formatBalance(value >= 0 ? 'income' : 'expense', value);
}

export default function WorkspacePage() {
  const navigate = useNavigate();
  const params = useParams();
  const { currentWorkspace, workspaceId: workspaceIdFromContext, loading, error, updateQuickButtons } = useWorkspace();
  const workspaceId = params.workspaceId || workspaceIdFromContext;

  const {
    operations,
    summary,
    addOperation,
    loading: operationsLoading,
    error: operationsError
  } = useOperations(workspaceId);

  const [modalType, setModalType] = useState(null);
  const [modalCategory, setModalCategory] = useState(null);
  const [showQuickSettings, setShowQuickSettings] = useState(false);
  const { hasManagementRights, canCreateOperations } = usePermissions();
  const quickButtons = currentWorkspace?.quick_buttons || [];
  const { categories } = useCategories(workspaceId);
  const { accounts, loadBalances } = useAccounts(workspaceId);
  const { activeDebts } = useDebts(workspaceId);
  const [balances, setBalances] = useState({});
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);

  // Dashboard block visibility (localStorage per workspace)
  const [dashboardBlocks, setDashboardBlocks] = useState(() => {
    if (!workspaceId) return { debts: true };
    try {
      const stored = localStorage.getItem(`dashboardBlocks_${workspaceId}`);
      return stored ? { debts: true, ...JSON.parse(stored) } : { debts: true };
    } catch { return { debts: true }; }
  });
  const [dashboardSettingsOpen, setDashboardSettingsOpen] = useState(false);

  // Accounts "summary only" mode (localStorage per workspace)
  const [accountsSummaryOnly, setAccountsSummaryOnly] = useState(() => {
    if (!workspaceId) return false;
    return localStorage.getItem(`accountsSummaryOnly_${workspaceId}`) === 'true';
  });

  // Visible accounts from localStorage (null = all visible)
  const [visibleAccountIds, setVisibleAccountIds] = useState(() => {
    if (!workspaceId) return null;
    const stored = localStorage.getItem(`visibleAccounts_${workspaceId}`);
    if (!stored) return null;
    try { return JSON.parse(stored); } catch { return null; }
  });

  // Sync visibleAccountIds when workspaceId changes
  useEffect(() => {
    if (!workspaceId) { setVisibleAccountIds(null); return; }
    const stored = localStorage.getItem(`visibleAccounts_${workspaceId}`);
    if (!stored) { setVisibleAccountIds(null); return; }
    try { setVisibleAccountIds(JSON.parse(stored)); } catch { setVisibleAccountIds(null); }
  }, [workspaceId]);

  // Sync dashboard settings when workspaceId changes
  useEffect(() => {
    if (!workspaceId) return;
    try {
      const stored = localStorage.getItem(`dashboardBlocks_${workspaceId}`);
      setDashboardBlocks(stored ? { debts: true, ...JSON.parse(stored) } : { debts: true });
    } catch { setDashboardBlocks({ debts: true }); }
    setAccountsSummaryOnly(localStorage.getItem(`accountsSummaryOnly_${workspaceId}`) === 'true');
  }, [workspaceId]);

  const activeAccounts = useMemo(() => accounts.filter(a => !a.is_archived), [accounts]);

  const toggleAccountVisibility = useCallback((accountId) => {
    setVisibleAccountIds(prev => {
      // If null (all visible), start with all IDs minus the toggled one
      const allIds = activeAccounts.map(a => a.id);
      const current = prev || allIds;
      let next;
      if (current.includes(accountId)) {
        next = current.filter(id => id !== accountId);
        // Don't allow empty selection
        if (next.length === 0) return prev;
      } else {
        next = [...current, accountId];
      }
      // If all selected, store null (= all)
      if (next.length >= allIds.length) {
        localStorage.removeItem(`visibleAccounts_${workspaceId}`);
        return null;
      }
      localStorage.setItem(`visibleAccounts_${workspaceId}`, JSON.stringify(next));
      return next;
    });
  }, [activeAccounts, workspaceId]);

  const displayedAccounts = useMemo(() => {
    if (!visibleAccountIds) return activeAccounts;
    return activeAccounts.filter(a => visibleAccountIds.includes(a.id));
  }, [activeAccounts, visibleAccountIds]);

  useEffect(() => {
    if (workspaceId) {
      loadBalances().then(setBalances);
    }
  }, [workspaceId, loadBalances, operations]);

  const [summaryMode, setSummaryMode] = useState(
    () => localStorage.getItem('summaryMode') || 'expanded'
  );
  const [summaryPinned, setSummaryPinned] = useState(
    () => localStorage.getItem('summaryPinned') === 'true'
  );
  const [todayOpen, setTodayOpen] = useState(true);
  const [monthOpen, setMonthOpen] = useState(true);

  const toggleSummaryMode = useCallback(() => {
    setSummaryMode((prev) => {
      const next = prev === 'compact' ? 'expanded' : 'compact';
      if (summaryPinned) localStorage.setItem('summaryMode', next);
      return next;
    });
  }, [summaryPinned]);

  const togglePin = useCallback(() => {
    setSummaryPinned((prev) => {
      const next = !prev;
      if (next) {
        localStorage.setItem('summaryPinned', 'true');
        localStorage.setItem('summaryMode', summaryMode);
      } else {
        localStorage.removeItem('summaryPinned');
        localStorage.removeItem('summaryMode');
      }
      return next;
    });
  }, [summaryMode]);

  const todayTotalColor = useMemo(() => (
    (summary?.today?.total || 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
  ), [summary?.today?.total]);

  const monthTotalColor = useMemo(() => (
    (summary?.month?.total || 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
  ), [summary?.month?.total]);

  const topExpenseCategories = useMemo(() => {
    if (!operations || !categories || categories.length === 0) return [];

    const catMap = new Map();
    operations.forEach(op => {
      if ((op.type === 'expense' || op.type === 'salary') && op.category_id) {
        const existing = catMap.get(op.category_id) || 0;
        catMap.set(op.category_id, existing + Number(op.amount || 0));
      }
    });

    return Array.from(catMap.entries())
      .map(([catId, amount]) => {
        const cat = categories.find(c => c.id === catId);
        return { id: catId, name: cat?.name || 'Без категории', color: cat?.color || '#6B7280', amount };
      })
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 3);
  }, [operations, categories]);

  const goToWorkspaceSelect = () => {
    navigate('/workspaces');
  };

  const openOperationForm = (type, category = null) => {
    setModalType(type || 'income');
    setModalCategory(category);
  };

  const openOperations = () => {
    navigate(workspaceId ? `/operations?workspaceId=${workspaceId}` : '/operations');
  };

  const openAnalytics = () => {
    navigate(workspaceId ? `/analytics?workspaceId=${workspaceId}` : '/analytics');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 dark:border-primary-400 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Загрузка рабочего пространства...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="card w-full max-w-md text-center">
          <div className="text-red-600 dark:text-red-400 mb-4">{error}</div>
          <button
            onClick={goToWorkspaceSelect}
            className="btn-primary"
          >
            Вернуться к выбору рабочих пространств
          </button>
        </div>
      </div>
    );
  }

  if (!currentWorkspace) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-gray-600 dark:text-gray-400">Рабочее пространство не найдено</div>
          <button
            onClick={goToWorkspaceSelect}
            className="btn-secondary mt-4"
          >
            Вернуться к выбору
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative">
      <div className="max-w-2xl mx-auto p-4">
        <div className="space-y-4 mb-20">
          {/* Summary blocks */}
          {operationsLoading ? (
            <div className="grid grid-cols-2 gap-3">
              {[0, 1].map((i) => (
                <div key={i} className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-4 border border-gray-200 dark:border-gray-700 animate-pulse">
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-20 mb-3"></div>
                  <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-28"></div>
                </div>
              ))}
            </div>
          ) : summaryMode === 'compact' ? (
            <div className="relative">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { icon: <BarChart3 size={16} className="text-gray-500 dark:text-gray-400" />, label: 'Сегодня', total: summary?.today?.total || 0,  color: todayTotalColor },
                  { icon: <TrendingUp size={16} className="text-gray-500 dark:text-gray-400" />, label: 'Месяц',   total: summary?.month?.total || 0, color: monthTotalColor },
                ].map(({ icon, label, total, color }) => (
                  <div key={label} className="bg-white dark:bg-gray-800 rounded-xl shadow-md px-3 py-2.5 border border-gray-200 dark:border-gray-700">
                    <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 mb-1">{icon}{label}</div>
                    <div className={`text-lg font-bold leading-tight tabular-nums ${color}`}>
                      {formatSignedAmount(total)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-1.5 mt-2">
                <button
                  onClick={togglePin}
                  title={summaryPinned ? 'Открепить вид' : 'Закрепить вид'}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full border transition-colors ${
                    summaryPinned
                      ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400'
                      : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-400'
                  }`}
                >
                  <Pin size={14} />{summaryPinned ? ' Закреплено' : ''}
                </button>
                <button
                  onClick={toggleSummaryMode}
                  title="Развернуть"
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded-full border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-400 transition-colors"
                >
                  <Maximize2 size={14} /> Подробно
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {[
                {
                  key: 'today', label: <><BarChart3 size={16} className="text-gray-500 dark:text-gray-400" /> За сегодня</>,
                  total: summary?.today?.total || 0,
                  color: todayTotalColor,
                  income: summary?.today?.income || 0,
                  expense: summary?.today?.expense || 0,
                  salary: summary?.today?.salary || 0,
                  open: todayOpen, toggle: () => setTodayOpen((v) => !v),
                },
                {
                  key: 'month', label: <><TrendingUp size={16} className="text-gray-500 dark:text-gray-400" /> За месяц</>,
                  total: summary?.month?.total || 0,
                  color: monthTotalColor,
                  income: summary?.month?.income || 0,
                  expense: summary?.month?.expense || 0,
                  salary: summary?.month?.salary || 0,
                  open: monthOpen, toggle: () => setMonthOpen((v) => !v),
                },
              ].map(({ key, label, total, color, income, expense, salary, open, toggle }) => (
                <div key={key} className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <button
                    onClick={toggle}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1 text-sm font-medium text-gray-600 dark:text-gray-400">{label}</span>
                      <span className={`text-xl font-bold tabular-nums ${color}`}>
                        {formatSignedAmount(total)}
                      </span>
                    </div>
                    <span className="text-gray-400 dark:text-gray-500 text-sm">{open ? '▲' : '▼'}</span>
                  </button>
                  {open && (
                    <div className="px-4 pb-3 border-t border-gray-100 dark:border-gray-700">
                      <div className="text-xs text-gray-500 dark:text-gray-400 pt-2 space-y-0.5">
                        <div>Доходы: <span className="text-green-600 dark:text-green-400 font-medium">+{formatUnsignedAmount(income)}</span></div>
                        <div>Расходы: <span className="text-red-600 dark:text-red-400 font-medium">−{formatUnsignedAmount(expense)}</span></div>
                        <div>Зарплаты: <span className="text-primary-600 dark:text-primary-400 font-medium">−{formatUnsignedAmount(salary)}</span></div>
                      </div>
                      {key === 'month' && topExpenseCategories.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700" data-testid="top-categories">
                          <div className="text-xs text-gray-400 dark:text-gray-500 mb-1">Топ расходов:</div>
                          {topExpenseCategories.map(cat => {
                            const maxAmt = topExpenseCategories[0]?.amount || 1;
                            return (
                              <div key={cat.id} className="flex items-center gap-2 mb-1">
                                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                                <span className="text-xs text-gray-600 dark:text-gray-400 truncate flex-1">{cat.name}</span>
                                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{formatUnsignedAmount(cat.amount)}</span>
                                <div className="w-16 bg-gray-100 dark:bg-gray-700 rounded-full h-1.5">
                                  <div className="h-1.5 rounded-full" style={{ width: `${Math.round((cat.amount / maxAmt) * 100)}%`, backgroundColor: cat.color }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <button onClick={openAnalytics} className="mt-2 text-xs text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-300">
                        Детали →
                      </button>
                    </div>
                  )}
                </div>
              ))}
              <div className="flex justify-end gap-1.5">
                <button
                  onClick={togglePin}
                  title={summaryPinned ? 'Открепить вид' : 'Закрепить вид'}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full border transition-colors ${
                    summaryPinned
                      ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400'
                      : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-400'
                  }`}
                >
                  <Pin size={14} />{summaryPinned ? ' Закреплено' : ''}
                </button>
                <button
                  onClick={toggleSummaryMode}
                  title="Свернуть"
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded-full border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-400 transition-colors"
                >
                  <Minimize2 size={14} /> Компактно
                </button>
              </div>
            </div>
          )}

          {operationsError && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl p-3 text-sm text-red-700 dark:text-red-400">
              {operationsError}
            </div>
          )}

          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => openOperationForm('income')}
              disabled={!canCreateOperations}
              className="px-3 py-2 rounded-xl bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 disabled:opacity-50 font-medium text-sm btn-press"
            >
              + Доход
            </button>
            <button
              onClick={() => openOperationForm('expense')}
              disabled={!canCreateOperations}
              className="px-3 py-2 rounded-xl bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 disabled:opacity-50 font-medium text-sm btn-press"
            >
              + Расход
            </button>
            {accounts.filter(a => !a.is_archived).length > 1 && (
              <button
                onClick={() => openOperationForm('transfer')}
                disabled={!canCreateOperations}
                className="px-3 py-2 rounded-xl bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-800 disabled:opacity-50 font-medium text-sm btn-press"
              >
                ⇄ Перевод
              </button>
            )}
            {quickButtons.map((btn, i) => (
              <button
                key={i}
                onClick={() => openOperationForm(btn.type, btn.category)}
                disabled={!canCreateOperations}
                className="px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 disabled:opacity-50 font-medium text-sm hover:bg-gray-100 dark:hover:bg-gray-750"
              >
                + {btn.label}
              </button>
            ))}
            {hasManagementRights && quickButtons.length < 5 && (
              <button
                onClick={() => setShowQuickSettings(true)}
                className="p-2 rounded-xl text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                <Plus size={16} />
              </button>
            )}
          </div>

          {/* Dashboard visibility settings */}
          <div className="flex justify-end">
            <button
              onClick={() => setDashboardSettingsOpen(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                dashboardSettingsOpen
                  ? 'text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800'
                  : 'text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
              title="Настройка виджетов"
            >
              {dashboardSettingsOpen ? <EyeOff size={14} /> : <Eye size={14} />}
              Виджеты
            </button>
          </div>
          {dashboardSettingsOpen && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-3 border border-gray-200 dark:border-gray-700">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Показывать на главной:</p>
              <label className="flex items-center gap-2 cursor-pointer py-0.5">
                <input
                  type="checkbox"
                  checked={dashboardBlocks.debts !== false}
                  onChange={() => {
                    setDashboardBlocks(prev => {
                      const next = { ...prev, debts: !prev.debts };
                      localStorage.setItem(`dashboardBlocks_${workspaceId}`, JSON.stringify(next));
                      return next;
                    });
                  }}
                  className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
                />
                <Receipt size={14} className="text-gray-500 dark:text-gray-400" />
                <span className="text-sm text-gray-700 dark:text-gray-300">Долги</span>
              </label>
            </div>
          )}

          {/* Account balances */}
          {activeAccounts.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-4 border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Wallet size={16} className="text-gray-500 dark:text-gray-400" />
                  <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Счета</h3>
                </div>
                <div className="flex items-center gap-1.5">
                  {visibleAccountIds && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
                      [{displayedAccounts.length}/{activeAccounts.length}]
                    </span>
                  )}
                  <button
                    onClick={() => setAccountSettingsOpen(v => !v)}
                    className={`p-1 rounded transition-colors ${
                      accountSettingsOpen
                        ? 'text-primary-600 dark:text-primary-400'
                        : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
                    }`}
                    title="Настройка отображения счетов"
                  >
                    <Settings size={15} />
                  </button>
                </div>
              </div>

              {accountSettingsOpen && (
                <div className="mb-3 p-2 bg-gray-50 dark:bg-gray-750 rounded-lg border border-gray-200 dark:border-gray-700 space-y-1">
                  <label className="flex items-center gap-2 cursor-pointer py-0.5 mb-1 pb-1.5 border-b border-gray-200 dark:border-gray-700">
                    <input
                      type="checkbox"
                      checked={accountsSummaryOnly}
                      onChange={() => {
                        setAccountsSummaryOnly(prev => {
                          const next = !prev;
                          if (next) {
                            localStorage.setItem(`accountsSummaryOnly_${workspaceId}`, 'true');
                          } else {
                            localStorage.removeItem(`accountsSummaryOnly_${workspaceId}`);
                          }
                          return next;
                        });
                      }}
                      className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">Только итого</span>
                  </label>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Отображать на главной:</p>
                  {activeAccounts.map(acc => {
                    const isVisible = !visibleAccountIds || visibleAccountIds.includes(acc.id);
                    return (
                      <label key={acc.id} className="flex items-center gap-2 cursor-pointer py-0.5">
                        <input
                          type="checkbox"
                          checked={isVisible}
                          onChange={() => toggleAccountVisibility(acc.id)}
                          className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
                        />
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: acc.color || '#6B7280' }} />
                        <span className="text-sm text-gray-700 dark:text-gray-300">{acc.name}</span>
                      </label>
                    );
                  })}
                </div>
              )}

              {accountsSummaryOnly ? (() => {
                const total = displayedAccounts.reduce((sum, acc) => sum + (balances[acc.id] || 0), 0);
                const totalColor = total >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
                return (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700 dark:text-gray-300">Итого</span>
                    <span className={`text-sm font-semibold tabular-nums ${totalColor}`}>
                      {formatSignedAmount(total)}
                    </span>
                  </div>
                );
              })() : (
                <div className="space-y-1.5">
                  {displayedAccounts.map(acc => {
                    const bal = balances[acc.id] || 0;
                    const balColor = bal >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
                    return (
                      <div key={acc.id} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: acc.color || '#6B7280' }} />
                          <span className="text-sm text-gray-700 dark:text-gray-300">{acc.name}</span>
                        </div>
                        <span className={`text-sm font-semibold tabular-nums ${balColor}`}>
                          {formatSignedAmount(bal)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Debts widget */}
          {dashboardBlocks.debts !== false && activeDebts.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-4 border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Receipt size={16} className="text-gray-500 dark:text-gray-400" />
                  <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Долги</h3>
                </div>
                <button
                  onClick={() => navigate(workspaceId ? `/debts?workspaceId=${workspaceId}` : '/debts')}
                  className="text-xs text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-300"
                >
                  Все долги
                </button>
              </div>
              <div className="space-y-2">
                {activeDebts.slice(0, 5).map(debt => {
                  const progressPct = Number(debt.progress_pct || 0);
                  const isIOwe = debt.direction === 'i_owe';
                  const barColor = isIOwe ? 'bg-red-500' : 'bg-green-500';
                  const dirLabel = isIOwe ? 'Я должен' : 'Мне должны';
                  const dirColor = isIOwe ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400';
                  return (
                    <div key={debt.id} className="p-2 bg-gray-50 dark:bg-gray-750 rounded-lg">
                      <div className="flex items-center justify-between mb-1">
                        <div className="min-w-0 flex-1">
                          <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate block">{debt.title}</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">{debt.counterparty}</span>
                        </div>
                        <div className="text-right ml-2 flex-shrink-0">
                          <span className={`text-xs font-medium ${dirColor}`}>{dirLabel}</span>
                          <div className="text-sm font-semibold text-gray-800 dark:text-gray-200 tabular-nums">
                            {formatUnsignedAmount(Number(debt.remaining_amount))} <span className="text-xs text-gray-400 font-normal">/ {formatUnsignedAmount(Number(debt.initial_amount))}</span>
                          </div>
                        </div>
                      </div>
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full ${barColor} transition-all`} style={{ width: `${progressPct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-4 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Последние операции</h3>
              <button onClick={openOperations} className="text-xs text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-300">
                Все операции
              </button>
            </div>
            {operationsLoading ? (
              <div className="text-center py-6 text-gray-400 dark:text-gray-500 text-sm">Загрузка...</div>
            ) : operations && operations.length > 0 ? (
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {operations.slice(0, 5).map(op => {
                  const typeColors = {
                    income: 'text-green-600 dark:text-green-400',
                    expense: 'text-red-600 dark:text-red-400',
                    salary: 'text-primary-600 dark:text-primary-400',
                    transfer: 'text-gray-600 dark:text-gray-400',
                  };
                  const typeLabels = { income: 'Доход', expense: 'Расход', salary: 'Зарплата', transfer: 'Перевод' };
                  const color = typeColors[op.type] || 'text-gray-600 dark:text-gray-400';
                  // Skip 'in' transfers (show only 'out' to avoid duplicates)
                  if (op.type === 'transfer' && op.transfer_direction === 'in') return null;
                  return (
                    <div key={op.id} className="py-2 flex items-center justify-between">
                      <div className="min-w-0">
                        <span className={`text-xs font-medium ${color}`}>{typeLabels[op.type]}</span>
                        {op.description && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[180px]">{op.description}</p>
                        )}
                      </div>
                      <span className={`text-sm font-semibold ${color} ml-2 whitespace-nowrap`}>
                        {op.type === 'transfer'
                          ? formatUnsignedAmount(op.amount)
                          : formatSignedAmount(op.type === 'income' ? op.amount : -Math.abs(op.amount))}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <div className="mb-2"><FileText size={40} className="text-gray-300 dark:text-gray-600 mx-auto" /></div>
                <p className="text-sm">Операций пока нет</p>
                <p className="text-xs">Добавьте первую запись</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="fixed bottom-6 right-6">
        <button onClick={() => openOperationForm('income')} className="fab btn-press">
          <span className="text-2xl">+</span>
        </button>
      </div>

      {modalType && (
        <AddOperationModal
          type={modalType}
          defaultCategory={modalCategory}
          workspaceId={workspaceId}
          onClose={() => setModalType(null)}
          onSave={addOperation}
        />
      )}

      {showQuickSettings && (
        <QuickButtonsSettings
          workspaceId={workspaceId}
          buttons={quickButtons}
          onSave={(buttons) => { updateQuickButtons(buttons); setShowQuickSettings(false); }}
          onClose={() => setShowQuickSettings(false)}
        />
      )}

    </div>
  );
}
