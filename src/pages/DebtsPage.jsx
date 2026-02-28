import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import useDebts from '../hooks/useDebts';
import useAccounts from '../hooks/useAccounts';
import { useAuth } from '../contexts/AuthContext';
import DebtFormModal from '../components/DebtFormModal';
import AddOperationModal from '../components/AddOperationModal';
import { formatUnsignedAmount } from '../utils/formatters';
import { Plus, Pencil, Archive, ArchiveRestore, Trash2, ChevronDown, ChevronUp, Banknote } from 'lucide-react';

const DIRECTION_LABELS = { i_owe: 'Я должен', owed_to_me: 'Мне должны' };
const DIRECTION_COLORS = {
  i_owe: 'text-red-600 dark:text-red-400',
  owed_to_me: 'text-green-600 dark:text-green-400',
};

export function DebtsPage() {
  const [searchParams] = useSearchParams();
  const workspaceId = searchParams.get('workspaceId');
  const { workspaces } = useAuth();
  const currentWorkspace = workspaces?.find(w => w.id === workspaceId);

  const { debts, loading, error, createDebt, updateDebt, archiveDebt, unarchiveDebt, deleteDebt, getDebtHistory, refresh } = useDebts(workspaceId);
  const { accounts } = useAccounts(workspaceId);

  const [filterDirection, setFilterDirection] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [formModal, setFormModal] = useState(null); // null | 'add' | debt object
  const [quickPayDebt, setQuickPayDebt] = useState(null); // debt for quick pay modal
  const [expandedDebtId, setExpandedDebtId] = useState(null);
  const [debtHistory, setDebtHistory] = useState({});
  const [deleteError, setDeleteError] = useState('');

  const filteredDebts = debts.filter(d => {
    if (!showArchived && d.is_archived) return false;
    if (filterDirection && d.direction !== filterDirection) return false;
    return true;
  });

  const toggleExpand = useCallback(async (debtId) => {
    if (expandedDebtId === debtId) {
      setExpandedDebtId(null);
      return;
    }
    setExpandedDebtId(debtId);
    if (!debtHistory[debtId]) {
      const history = await getDebtHistory(debtId);
      setDebtHistory(prev => ({ ...prev, [debtId]: history }));
    }
  }, [expandedDebtId, debtHistory, getDebtHistory]);

  const handleDelete = useCallback(async (id) => {
    setDeleteError('');
    const result = await deleteDebt(id);
    if (result.error) setDeleteError(result.error);
  }, [deleteDebt]);

  const handleFormSave = useCallback(async (data) => {
    if (formModal && formModal.id) {
      await updateDebt(formModal.id, data);
    } else {
      await createDebt(data);
    }
  }, [formModal, createDebt, updateDebt]);

  const handleQuickPaySave = useCallback(async () => {
    // After operation modal closes, refresh debts
    await refresh();
    setQuickPayDebt(null);
  }, [refresh]);

  // Auto-clear delete error
  useEffect(() => {
    if (deleteError) {
      const t = setTimeout(() => setDeleteError(''), 5000);
      return () => clearTimeout(t);
    }
  }, [deleteError]);

  if (!workspaceId) {
    return <div className="p-4 text-center text-gray-500 dark:text-gray-400">Выберите рабочее пространство</div>;
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">Долги и обязательства</h1>
        <button
          onClick={() => setFormModal('add')}
          className="px-3 py-2 rounded-xl bg-primary-600 text-white hover:bg-primary-700 transition-colors font-medium text-sm flex items-center gap-1.5"
        >
          <Plus size={16} /> Добавить
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { key: null, label: 'Все' },
          { key: 'i_owe', label: 'Я должен' },
          { key: 'owed_to_me', label: 'Мне должны' },
        ].map(({ key, label }) => (
          <button
            key={String(key)}
            onClick={() => setFilterDirection(key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              filterDirection === key
                ? 'bg-primary-600 dark:bg-primary-500 text-white border-primary-600 dark:border-primary-500'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-primary-400 hover:text-primary-600'
            }`}
          >
            {label}
          </button>
        ))}

        <span className="text-gray-300 dark:text-gray-600 select-none">|</span>

        <button
          onClick={() => setShowArchived(!showArchived)}
          className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
            showArchived
              ? 'bg-gray-700 dark:bg-gray-600 text-white border-gray-700 dark:border-gray-600'
              : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600'
          }`}
        >
          Архив
        </button>
      </div>

      {deleteError && (
        <div className="text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/20 rounded-lg p-3">{deleteError}</div>
      )}

      {/* Loading */}
      {loading && <div className="text-center py-8 text-gray-500 dark:text-gray-400">Загрузка...</div>}

      {/* Empty state */}
      {!loading && filteredDebts.length === 0 && (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <Banknote size={48} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-sm">Долгов пока нет</p>
          <p className="text-xs">Добавьте первый долг или обязательство</p>
        </div>
      )}

      {/* Debt cards */}
      <div className="space-y-3">
        {filteredDebts.map(debt => {
          const isExpanded = expandedDebtId === debt.id;
          const history = debtHistory[debt.id] || [];
          const progressColor = debt.direction === 'i_owe'
            ? 'bg-red-500 dark:bg-red-400'
            : 'bg-green-500 dark:bg-green-400';
          const isPaidOff = debt.remaining_amount <= 0;

          return (
            <div
              key={debt.id}
              className={`bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden ${debt.is_archived ? 'opacity-60' : ''}`}
            >
              {/* Card header */}
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-medium ${DIRECTION_COLORS[debt.direction]}`}>
                        {DIRECTION_LABELS[debt.direction]}
                      </span>
                      {debt.is_archived && <span className="text-xs bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 px-1.5 py-0.5 rounded">архив</span>}
                      {isPaidOff && !debt.is_archived && <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-1.5 py-0.5 rounded">погашен</span>}
                    </div>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{debt.title}</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{debt.counterparty}</p>
                    {debt.due_on && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">до {new Date(debt.due_on).toLocaleDateString('ru-RU')}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-lg font-bold tabular-nums text-gray-900 dark:text-gray-100">
                      {formatUnsignedAmount(debt.remaining_amount)}
                    </div>
                    <div className="text-xs text-gray-400 dark:text-gray-500">
                      из {formatUnsignedAmount(debt.initial_amount)}
                    </div>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mt-3 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${progressColor}`}
                    style={{ width: `${Math.min(debt.progress_pct, 100)}%` }}
                  />
                </div>
                <div className="text-xs text-gray-400 dark:text-gray-500 mt-1 text-right">{debt.progress_pct}%</div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 mt-2">
                  {!debt.is_archived && !isPaidOff && (
                    <button
                      onClick={() => setQuickPayDebt(debt)}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 border border-primary-200 dark:border-primary-800 hover:bg-primary-100 dark:hover:bg-primary-900/50 transition-colors"
                    >
                      Оплатить
                    </button>
                  )}
                  <button
                    onClick={() => setFormModal(debt)}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    title="Редактировать"
                  >
                    <Pencil size={14} />
                  </button>
                  {debt.is_archived ? (
                    <button
                      onClick={() => unarchiveDebt(debt.id)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-green-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      title="Разархивировать"
                    >
                      <ArchiveRestore size={14} />
                    </button>
                  ) : (
                    <button
                      onClick={() => archiveDebt(debt.id)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      title="Архивировать"
                    >
                      <Archive size={14} />
                    </button>
                  )}
                  {debt.is_archived && (
                    <button
                      onClick={() => handleDelete(debt.id)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      title="Удалить"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                  <button
                    onClick={() => toggleExpand(debt.id)}
                    className="ml-auto p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    title="История платежей"
                  >
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                </div>
              </div>

              {/* Expanded: payment history */}
              {isExpanded && (
                <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3 bg-gray-50 dark:bg-gray-750">
                  <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">История платежей</h4>
                  {history.length === 0 ? (
                    <p className="text-xs text-gray-400 dark:text-gray-500">Платежей ещё не было</p>
                  ) : (
                    <div className="space-y-1.5">
                      {history.map(op => (
                        <div key={op.id} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                              {new Date(op.operation_date).toLocaleDateString('ru-RU')}
                            </span>
                            {op.description && (
                              <span className="text-xs text-gray-600 dark:text-gray-300 truncate">{op.description}</span>
                            )}
                          </div>
                          <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100 shrink-0 ml-2">
                            −{formatUnsignedAmount(op.debt_applied_amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Modals */}
      {formModal && (
        <DebtFormModal
          debt={formModal === 'add' ? null : formModal}
          onClose={() => setFormModal(null)}
          onSave={handleFormSave}
        />
      )}

      {quickPayDebt && (
        <AddOperationModal
          type={quickPayDebt.direction === 'i_owe' ? 'expense' : 'income'}
          workspaceId={workspaceId}
          onClose={() => { handleQuickPaySave(); }}
          onSave={async (payload) => {
            // The payload already goes through useOperations.addOperation
            // We just need to ensure debt_id and debt_applied_amount are set
          }}
          prefillDebt={quickPayDebt}
        />
      )}
    </div>
  );
}

export default DebtsPage;
