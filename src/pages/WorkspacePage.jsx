import { useMemo, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useWorkspace } from '../contexts/WorkspaceContext';
import useOperations from '../hooks/useOperations';
import { usePermissions } from '../hooks/usePermissions';
import AddOperationModal from '../components/AddOperationModal';
import QuickButtonsSettings from '../components/QuickButtonsSettings';
import { Plus, BarChart3, TrendingUp, FileText, Pin, Minimize2, Maximize2 } from 'lucide-react';
import { formatUnsignedAmount, formatSignedAmount as formatBalance } from '../utils/formatters';
import useCategories from '../hooks/useCategories';

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

  const [modalType, setModalType] = useState(null); // null = closed, 'income'|'expense'|'salary'
  const [modalCategory, setModalCategory] = useState(null);
  const [showQuickSettings, setShowQuickSettings] = useState(false);
  const { hasManagementRights, canCreateOperations } = usePermissions();
  const quickButtons = currentWorkspace?.quick_buttons || [];
  const { categories } = useCategories(workspaceId);

  // Режим итоговых блоков: 'compact' | 'expanded'
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
    (summary?.today?.total || 0) >= 0 ? 'text-green-600' : 'text-red-600'
  ), [summary?.today?.total]);

  const monthTotalColor = useMemo(() => (
    (summary?.month?.total || 0) >= 0 ? 'text-green-600' : 'text-red-600'
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
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Загрузка рабочего пространства...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="card w-full max-w-md text-center">
          <div className="text-red-600 mb-4">{error}</div>
          <button
            onClick={goToWorkspaceSelect}
            className="btn btn-primary"
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
          <div className="text-gray-600">Рабочее пространство не найдено</div>
          <button
            onClick={goToWorkspaceSelect}
            className="btn btn-secondary mt-4"
          >
            Вернуться к выбору
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen relative ${currentWorkspace?.is_personal ? 'bg-amber-50' : 'bg-gray-50'}`}>
      <div className="max-w-2xl mx-auto p-4">
        <div className="space-y-4 mb-20">
          {/* ── Итоговые блоки ── */}
          {operationsLoading ? (
            <div className="grid grid-cols-2 gap-3">
              {[0, 1].map((i) => (
                <div key={i} className="bg-white rounded-lg shadow-sm p-4 border border-gray-200 animate-pulse">
                  <div className="h-3 bg-gray-200 rounded w-20 mb-3"></div>
                  <div className="h-6 bg-gray-200 rounded w-28"></div>
                </div>
              ))}
            </div>
          ) : summaryMode === 'compact' ? (
            /* ── Компактный вид: два блока в одну строку ── */
            <div className="relative">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { icon: <BarChart3 size={16} className="text-gray-500" />, label: 'Сегодня', total: summary?.today?.total || 0,  color: todayTotalColor },
                  { icon: <TrendingUp size={16} className="text-gray-500" />, label: 'Месяц',   total: summary?.month?.total || 0, color: monthTotalColor },
                ].map(({ icon, label, total, color }) => (
                  <div key={label} className="bg-white rounded-lg shadow-sm px-3 py-2.5 border border-gray-200">
                    <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">{icon}{label}</div>
                    <div className={`text-lg font-bold leading-tight tabular-nums ${color}`}>
                      {formatSignedAmount(total)}
                    </div>
                  </div>
                ))}
              </div>
              {/* Тогл и пин */}
              <div className="flex justify-end gap-1.5 mt-2">
                <button
                  onClick={togglePin}
                  title={summaryPinned ? 'Открепить вид' : 'Закрепить вид'}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors ${
                    summaryPinned
                      ? 'bg-amber-100 border-amber-300 text-amber-700'
                      : 'bg-white border-gray-300 text-gray-500 hover:border-gray-400'
                  }`}
                >
                  <Pin size={14} />{summaryPinned ? ' Закреплено' : ''}
                </button>
                <button
                  onClick={toggleSummaryMode}
                  title="Развернуть"
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white border-gray-300 text-gray-500 hover:border-gray-400 transition-colors"
                >
                  <Maximize2 size={14} /> Подробно
                </button>
              </div>
            </div>
          ) : (
            /* ── Расширенный вид: аккордион ── */
            <div className="space-y-3">
              {[
                {
                  key: 'today', label: <><BarChart3 size={16} className="text-gray-500" /> За сегодня</>,
                  total: summary?.today?.total || 0,
                  color: todayTotalColor,
                  income: summary?.today?.income || 0,
                  expense: summary?.today?.expense || 0,
                  salary: summary?.today?.salary || 0,
                  open: todayOpen, toggle: () => setTodayOpen((v) => !v),
                },
                {
                  key: 'month', label: <><TrendingUp size={16} className="text-gray-500" /> За месяц</>,
                  total: summary?.month?.total || 0,
                  color: monthTotalColor,
                  income: summary?.month?.income || 0,
                  expense: summary?.month?.expense || 0,
                  salary: summary?.month?.salary || 0,
                  open: monthOpen, toggle: () => setMonthOpen((v) => !v),
                },
              ].map(({ key, label, total, color, income, expense, salary, open, toggle }) => (
                <div key={key} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                  <button
                    onClick={toggle}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1 text-sm font-medium text-gray-600">{label}</span>
                      <span className={`text-xl font-bold tabular-nums ${color}`}>
                        {formatSignedAmount(total)}
                      </span>
                    </div>
                    <span className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
                  </button>
                  {open && (
                    <div className="px-4 pb-3 border-t border-gray-100">
                      <div className="text-xs text-gray-500 pt-2 space-y-0.5">
                        <div>Доходы: <span className="text-green-600 font-medium">+{formatUnsignedAmount(income)}</span></div>
                        <div>Расходы: <span className="text-red-600 font-medium">−{formatUnsignedAmount(expense)}</span></div>
                        <div>Зарплаты: <span className="text-blue-600 font-medium">−{formatUnsignedAmount(salary)}</span></div>
                      </div>
                      {key === 'month' && topExpenseCategories.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-gray-100" data-testid="top-categories">
                          <div className="text-xs text-gray-400 mb-1">Топ расходов:</div>
                          {topExpenseCategories.map(cat => {
                            const maxAmt = topExpenseCategories[0]?.amount || 1;
                            return (
                              <div key={cat.id} className="flex items-center gap-2 mb-1">
                                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                                <span className="text-xs text-gray-600 truncate flex-1">{cat.name}</span>
                                <span className="text-xs font-medium text-gray-700">{formatUnsignedAmount(cat.amount)}</span>
                                <div className="w-16 bg-gray-100 rounded-full h-1.5">
                                  <div className="h-1.5 rounded-full" style={{ width: `${Math.round((cat.amount / maxAmt) * 100)}%`, backgroundColor: cat.color }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <button onClick={openAnalytics} className="mt-2 text-xs text-blue-600 hover:text-blue-800">
                        Детали →
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {/* Тогл и пин */}
              <div className="flex justify-end gap-1.5">
                <button
                  onClick={togglePin}
                  title={summaryPinned ? 'Открепить вид' : 'Закрепить вид'}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded border transition-colors ${
                    summaryPinned
                      ? 'bg-amber-100 border-amber-300 text-amber-700'
                      : 'bg-white border-gray-300 text-gray-500 hover:border-gray-400'
                  }`}
                >
                  <Pin size={14} />{summaryPinned ? ' Закреплено' : ''}
                </button>
                <button
                  onClick={toggleSummaryMode}
                  title="Свернуть"
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white border-gray-300 text-gray-500 hover:border-gray-400 transition-colors"
                >
                  <Minimize2 size={14} /> Компактно
                </button>
              </div>
            </div>
          )}

          {operationsError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              {operationsError}
            </div>
          )}

          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => openOperationForm('income')}
              disabled={!canCreateOperations}
              className="px-3 py-2 rounded-lg bg-green-50 text-green-700 border border-green-200 disabled:opacity-50 font-medium text-sm btn-press"
            >
              ＋ Доход
            </button>
            <button
              onClick={() => openOperationForm('expense')}
              disabled={!canCreateOperations}
              className="px-3 py-2 rounded-lg bg-red-50 text-red-700 border border-red-200 disabled:opacity-50 font-medium text-sm btn-press"
            >
              ＋ Расход
            </button>
            {quickButtons.map((btn, i) => (
              <button
                key={i}
                onClick={() => openOperationForm(btn.type, btn.category)}
                disabled={!canCreateOperations}
                className="px-3 py-2 rounded-lg bg-gray-50 text-gray-700 border border-gray-200 disabled:opacity-50 font-medium text-sm hover:bg-gray-100"
              >
                ＋ {btn.label}
              </button>
            ))}
            {hasManagementRights && quickButtons.length < 5 && (
              <button
                onClick={() => setShowQuickSettings(true)}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-300 transition-colors"
              >
                <Plus size={16} />
              </button>
            )}
          </div>

          <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-900">Последние операции</h3>
              <button onClick={openOperations} className="text-xs text-blue-600 hover:text-blue-800">
                Все операции
              </button>
            </div>
            {operationsLoading ? (
              <div className="text-center py-6 text-gray-400 text-sm">Загрузка...</div>
            ) : operations && operations.length > 0 ? (
              <div className="divide-y divide-gray-100">
                {operations.slice(0, 5).map(op => {
                  const typeColors = { income: 'text-green-600', expense: 'text-red-600', salary: 'text-blue-600' };
                  const typeLabels = { income: 'Доход', expense: 'Расход', salary: 'Зарплата' };
                  const color = typeColors[op.type] || 'text-gray-600';
                  return (
                    <div key={op.id} className="py-2 flex items-center justify-between">
                      <div className="min-w-0">
                        <span className={`text-xs font-medium ${color}`}>{typeLabels[op.type]}</span>
                        {op.description && (
                          <p className="text-xs text-gray-500 truncate max-w-[180px]">{op.description}</p>
                        )}
                      </div>
                      <span className={`text-sm font-semibold ${color} ml-2 whitespace-nowrap`}>
                        {formatSignedAmount(op.type === 'income' ? op.amount : -Math.abs(op.amount))}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <div className="mb-2"><FileText size={40} className="text-gray-300 mx-auto" /></div>
                <p className="text-sm">Операций пока нет</p>
                <p className="text-xs">Добавьте первую запись</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="fixed bottom-6 right-6">
        <button onClick={() => openOperationForm('income')} className="w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg hover:shadow-xl transition-all duration-200 flex items-center justify-center btn-press">
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
