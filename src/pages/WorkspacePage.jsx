import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useWorkspace } from '../contexts/WorkspaceContext';
import useOperations from '../hooks/useOperations';
import AddOperationModal from '../components/AddOperationModal';
import { formatUnsignedAmount, formatSignedAmount as formatBalance } from '../utils/formatters';

function formatSignedAmount(value) {
  return formatBalance(value >= 0 ? 'income' : 'expense', value);
}

export default function WorkspacePage() {
  const navigate = useNavigate();
  const params = useParams();
  const { currentWorkspace, workspaceId: workspaceIdFromContext, loading, error } = useWorkspace();
  const workspaceId = params.workspaceId || workspaceIdFromContext;

  const {
    operations,
    summary,
    addOperation,
    loading: operationsLoading,
    error: operationsError
  } = useOperations(workspaceId);

  const [modalType, setModalType] = useState(null); // null = closed, 'income'|'expense'|'salary'

  const todayTotalColor = useMemo(() => (
    (summary?.today?.total || 0) >= 0 ? 'text-green-600' : 'text-red-600'
  ), [summary?.today?.total]);

  const monthTotalColor = useMemo(() => (
    (summary?.month?.total || 0) >= 0 ? 'text-green-600' : 'text-red-600'
  ), [summary?.month?.total]);

  const goToWorkspaceSelect = () => {
    navigate('/workspaces');
  };

  const openOperationForm = (type) => {
    setModalType(type || 'income');
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
          {operationsLoading ? (
            <>
              <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-28 mb-4"></div>
                <div className="h-8 bg-gray-200 rounded w-40 mb-3"></div>
                <div className="h-3 bg-gray-200 rounded w-full"></div>
              </div>
              <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-28 mb-4"></div>
                <div className="h-8 bg-gray-200 rounded w-40 mb-3"></div>
                <div className="h-3 bg-gray-200 rounded w-full"></div>
              </div>
            </>
          ) : (
            <>
              <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-600">📊 За сегодня</h3>
                  <button onClick={openAnalytics} className="text-xs text-blue-600 hover:text-blue-800">
                    Детали
                  </button>
                </div>
                <div className={`text-2xl font-bold ${todayTotalColor}`}>
                  {formatSignedAmount(summary?.today?.total || 0)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Доходы: +{formatUnsignedAmount(summary?.today?.income || 0)} • Расходы: -{formatUnsignedAmount(summary?.today?.expense || 0)} • Зарплаты: -{formatUnsignedAmount(summary?.today?.salary || 0)}
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-600">📈 За месяц</h3>
                  <button onClick={openAnalytics} className="text-xs text-blue-600 hover:text-blue-800">
                    Детали
                  </button>
                </div>
                <div className={`text-2xl font-bold ${monthTotalColor}`}>
                  {formatSignedAmount(summary?.month?.total || 0)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Доходы: +{formatUnsignedAmount(summary?.month?.income || 0)} • Расходы: -{formatUnsignedAmount(summary?.month?.expense || 0)} • Зарплаты: -{formatUnsignedAmount(summary?.month?.salary || 0)}
                </div>
              </div>
            </>
          )}

          {operationsError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              {operationsError}
            </div>
          )}

          <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
            <h3 className="text-sm font-medium text-gray-900 mb-3">Быстрые действия</h3>
            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => openOperationForm('income')} className="flex items-center justify-center gap-1.5 px-2 py-1.5 bg-green-50 hover:bg-green-100 rounded-lg transition-colors">
                <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center shrink-0">
                  <span className="text-white text-xs leading-none">+</span>
                </div>
                <span className="text-xs font-medium text-green-700 truncate">Доход</span>
              </button>

              <button onClick={() => openOperationForm('expense')} className="flex items-center justify-center gap-1.5 px-2 py-1.5 bg-red-50 hover:bg-red-100 rounded-lg transition-colors">
                <div className="w-5 h-5 bg-red-500 rounded-full flex items-center justify-center shrink-0">
                  <span className="text-white text-xs leading-none">−</span>
                </div>
                <span className="text-xs font-medium text-red-700 truncate">Расход</span>
              </button>

              <button onClick={() => openOperationForm('salary')} className="flex items-center justify-center gap-1.5 px-2 py-1.5 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors">
                <div className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center shrink-0">
                  <span className="text-xs leading-none">💰</span>
                </div>
                <span className="text-xs font-medium text-blue-700 truncate">Зарплата</span>
              </button>
            </div>
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
                <div className="text-4xl mb-2">📝</div>
                <p className="text-sm">Операций пока нет</p>
                <p className="text-xs">Добавьте первую запись</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="fixed bottom-6 right-6">
        <button onClick={() => openOperationForm('income')} className="w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg hover:shadow-xl transition-all duration-200 flex items-center justify-center">
          <span className="text-2xl">+</span>
        </button>
      </div>

      {modalType && (
        <AddOperationModal
          type={modalType}
          onClose={() => setModalType(null)}
          onSave={addOperation}
        />
      )}

    </div>
  );
}
