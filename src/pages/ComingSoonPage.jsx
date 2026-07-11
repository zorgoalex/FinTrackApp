import { useNavigate, useLocation } from 'react-router-dom';

export default function ComingSoonPage() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-md border border-gray-200 dark:border-gray-700 p-8 max-w-sm w-full text-center">
        <div className="text-5xl mb-4">404</div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">Страница не найдена</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Ссылка устарела или адрес введён с ошибкой.</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-6 font-mono">{location.pathname}</p>
        <button
          onClick={() => navigate(-1)}
          className="w-full px-4 py-2 rounded-lg bg-primary-600 dark:bg-primary-500 hover:bg-primary-700 dark:hover:bg-primary-600 text-white text-sm font-medium transition-colors"
        >
          Вернуться назад
        </button>
      </div>
    </div>
  );
}
