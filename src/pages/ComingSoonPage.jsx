import { useNavigate, useLocation } from 'react-router-dom';

export default function ComingSoonPage() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-sm w-full text-center">
        <div className="text-5xl mb-4">🚧</div>
        <h1 className="text-xl font-semibold text-gray-900 mb-2">В процессе разработки</h1>
        <p className="text-sm text-gray-500 mb-1">Этот раздел ещё не готов.</p>
        <p className="text-xs text-gray-400 mb-6 font-mono">{location.pathname}</p>
        <button
          onClick={() => navigate(-1)}
          className="w-full px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
        >
          ← Назад
        </button>
      </div>
    </div>
  );
}
