import { useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { supabase } from '../contexts/AuthContext';

const EMPTY_SUMMARY = {
  income: 0,
  expense: 0,
  salary: 0,
  total: 0
};

function normalizeOperationType(rawType) {
  const type = (rawType || '').toString().toLowerCase();

  if (['income', 'in', 'поступление', 'доход'].includes(type)) {
    return 'income';
  }
  if (['expense', 'out', 'расход', 'трата'].includes(type)) {
    return 'expense';
  }
  if (['salary', 'зарплата'].includes(type)) {
    return 'salary';
  }

  return null;
}

function formatCurrency(value) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0
  }).format(value || 0);
}

export default function WorkspacePage() {
  const navigate = useNavigate();
  const { currentWorkspace, workspaceId, loading, error } = useWorkspace();
  const [todaySummary, setTodaySummary] = useState(EMPTY_SUMMARY);
  const [monthSummary, setMonthSummary] = useState(EMPTY_SUMMARY);
  
  console.log('WorkspacePage render:', { currentWorkspace, loading, error });

  const goToWorkspaceSelect = () => {
    navigate('/workspaces');
  };

  const openOperationForm = (type) => {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (workspaceId) params.set('workspaceId', workspaceId);
    navigate(`/operations?${params.toString()}`);
  };

  const openOperations = () => {
    navigate('/operations');
  };

  const openAnalytics = () => {
    navigate('/analytics');
  };

  useEffect(() => {
    if (!workspaceId) {
      setTodaySummary(EMPTY_SUMMARY);
      setMonthSummary(EMPTY_SUMMARY);
      return;
    }

    const loadWorkspaceSummaries = async () => {
      const attempts = [
        { table: 'operations', select: 'amount,type,operation_date,created_at' },
        { table: 'operations', select: 'amount,operation_type,operation_date,created_at' },
        { table: 'operations', select: 'amount,type,date,created_at' },
        { table: 'transactions', select: 'amount,type,date,created_at' }
      ];

      let rows = [];

      for (const attempt of attempts) {
        const { data, error: loadError } = await supabase
          .from(attempt.table)
          .select(attempt.select)
          .eq('workspace_id', workspaceId);

        if (!loadError && Array.isArray(data)) {
          rows = data;
          break;
        }
      }

      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

      const nextToday = { ...EMPTY_SUMMARY };
      const nextMonth = { ...EMPTY_SUMMARY };

      rows.forEach((row) => {
        const amount = Number(row.amount) || 0;
        const type = normalizeOperationType(row.type || row.operation_type);
        const dateValue = row.operation_date || row.date || row.created_at;
        const operationDate = dateValue ? new Date(dateValue) : null;

        if (!type || !operationDate || Number.isNaN(operationDate.getTime())) {
          return;
        }

        const normalizedAmount = Math.abs(amount);
        const isInMonth = operationDate >= startOfMonth && operationDate < endOfMonth;
        const isToday = operationDate >= startOfToday && operationDate < endOfToday;

        if (isInMonth) {
          nextMonth[type] += normalizedAmount;
        }
        if (isToday) {
          nextToday[type] += normalizedAmount;
        }
      });

      nextToday.total = nextToday.income - nextToday.expense - nextToday.salary;
      nextMonth.total = nextMonth.income - nextMonth.expense - nextMonth.salary;

      setTodaySummary(nextToday);
      setMonthSummary(nextMonth);
    };

    loadWorkspaceSummaries();
  }, [workspaceId]);

  const todayTotalColor = useMemo(() => (
    todaySummary.total >= 0 ? 'text-green-600' : 'text-red-600'
  ), [todaySummary.total]);

  const monthTotalColor = useMemo(() => (
    monthSummary.total >= 0 ? 'text-green-600' : 'text-red-600'
  ), [monthSummary.total]);

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
    <div className="min-h-screen bg-gray-50 relative">
      {/* Основное содержимое */}
      <div className="max-w-2xl mx-auto p-4">
        
        {/* Виджеты итогов */}
        <div className="space-y-4 mb-20">
          {/* Виджет "За сегодня" */}
          <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-600">📊 За сегодня</h3>
              <button onClick={openAnalytics} className="text-xs text-blue-600 hover:text-blue-800">
                Детали
              </button>
            </div>
            <div className={`text-2xl font-bold ${todayTotalColor}`}>
              {todaySummary.total >= 0 ? '+' : '-'}
              {formatCurrency(Math.abs(todaySummary.total))}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Доходы: {formatCurrency(todaySummary.income)} • Расходы: {formatCurrency(todaySummary.expense)} • Зарплаты: {formatCurrency(todaySummary.salary)}
            </div>
          </div>

          {/* Виджет "За месяц" */}
          <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-600">📈 За месяц</h3>
              <button onClick={openAnalytics} className="text-xs text-blue-600 hover:text-blue-800">
                Детали
              </button>
            </div>
            <div className={`text-2xl font-bold ${monthTotalColor}`}>
              {monthSummary.total >= 0 ? '+' : '-'}
              {formatCurrency(Math.abs(monthSummary.total))}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Доходы: {formatCurrency(monthSummary.income)} • Расходы: {formatCurrency(monthSummary.expense)} • Зарплаты: {formatCurrency(monthSummary.salary)}
            </div>
          </div>

          {/* Быстрые действия */}
          <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
            <h3 className="text-sm font-medium text-gray-900 mb-3">Быстрые действия</h3>
            <div className="grid grid-cols-3 gap-3">
              <button onClick={() => openOperationForm('income')} className="flex flex-col items-center p-3 bg-green-50 hover:bg-green-100 rounded-lg transition-colors">
                <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center mb-1">
                  <span className="text-white text-sm">+</span>
                </div>
                <span className="text-xs text-green-700">Доход</span>
              </button>
              
              <button onClick={() => openOperationForm('expense')} className="flex flex-col items-center p-3 bg-red-50 hover:bg-red-100 rounded-lg transition-colors">
                <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center mb-1">
                  <span className="text-white text-sm">-</span>
                </div>
                <span className="text-xs text-red-700">Расход</span>
              </button>
              
              <button onClick={() => openOperationForm('salary')} className="flex flex-col items-center p-3 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors">
                <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center mb-1">
                  <span className="text-white text-sm">💰</span>
                </div>
                <span className="text-xs text-blue-700">Зарплата</span>
              </button>
            </div>
          </div>

          {/* Последние операции */}
          <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-900">Последние операции</h3>
              <button onClick={openOperations} className="text-xs text-blue-600 hover:text-blue-800">
                Все операции
              </button>
            </div>
            <div className="text-center py-8 text-gray-500">
              <div className="text-4xl mb-2">📝</div>
              <p className="text-sm">Операций пока нет</p>
              <p className="text-xs">Добавьте первую операцию</p>
            </div>
          </div>
        </div>
      </div>

      {/* FAB кнопка */}
      <div className="fixed bottom-6 right-6">
        <button onClick={() => openOperationForm('income')} className="w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg hover:shadow-xl transition-all duration-200 flex items-center justify-center">
          <span className="text-2xl">+</span>
        </button>
      </div>

    </div>
  );
}
