import { useNavigate } from 'react-router-dom';
import { useWorkspace } from '../contexts/WorkspaceContext';

export default function WorkspacePage() {
  const navigate = useNavigate();
  const { currentWorkspace, loading, error } = useWorkspace();
  
  console.log('WorkspacePage render:', { currentWorkspace, loading, error });

  const goToWorkspaceSelect = () => {
    navigate('/workspaces');
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
    <div className="min-h-screen bg-gray-50 relative">
      {/* Основное содержимое */}
      <div className="max-w-2xl mx-auto p-4">
        
        {/* Виджеты итогов */}
        <div className="space-y-4 mb-20">
          {/* Виджет "За сегодня" */}
          <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-600">📊 За сегодня</h3>
              <button className="text-xs text-blue-600 hover:text-blue-800">
                Детали
              </button>
            </div>
            <div className="text-2xl font-bold text-green-600">+0 ₽</div>
            <div className="text-xs text-gray-500 mt-1">
              Доходы: 0 ₽ • Расходы: 0 ₽ • Зарплаты: 0 ₽
            </div>
          </div>

          {/* Виджет "За месяц" */}
          <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-600">📈 За месяц</h3>
              <button className="text-xs text-blue-600 hover:text-blue-800">
                Детали
              </button>
            </div>
            <div className="text-2xl font-bold text-green-600">+0 ₽</div>
            <div className="text-xs text-gray-500 mt-1">
              Доходы: 0 ₽ • Расходы: 0 ₽ • Зарплаты: 0 ₽
            </div>
          </div>

          {/* Быстрые действия */}
          <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
            <h3 className="text-sm font-medium text-gray-900 mb-3">Быстрые действия</h3>
            <div className="grid grid-cols-3 gap-3">
              <button className="flex flex-col items-center p-3 bg-green-50 hover:bg-green-100 rounded-lg transition-colors">
                <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center mb-1">
                  <span className="text-white text-sm">+</span>
                </div>
                <span className="text-xs text-green-700">Доход</span>
              </button>
              
              <button className="flex flex-col items-center p-3 bg-red-50 hover:bg-red-100 rounded-lg transition-colors">
                <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center mb-1">
                  <span className="text-white text-sm">-</span>
                </div>
                <span className="text-xs text-red-700">Расход</span>
              </button>
              
              <button className="flex flex-col items-center p-3 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors">
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
              <button className="text-xs text-blue-600 hover:text-blue-800">
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
        <button className="w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg hover:shadow-xl transition-all duration-200 flex items-center justify-center">
          <span className="text-2xl">+</span>
        </button>
      </div>

      {/* Иконка "Домой" внизу слева */}
      <div className="fixed bottom-6 left-6">
        <button 
          onClick={goToWorkspaceSelect}
          className="w-12 h-12 bg-white hover:bg-gray-50 border border-gray-200 rounded-full shadow-md hover:shadow-lg transition-all duration-200 flex items-center justify-center"
          title="К выбору рабочих пространств"
        >
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        </button>
      </div>
    </div>
  );
}