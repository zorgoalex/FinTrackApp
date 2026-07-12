import { LogIn } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function SocialAuthButtons({ mode = 'login' }) {
  const { loginWithWorkOS, workosEnabled, loading } = useAuth();
  if (!workosEnabled) return null;

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={loginWithWorkOS}
        disabled={loading}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 transition hover:border-primary-400 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:border-primary-500 dark:hover:bg-gray-700"
      >
        <span className="grid h-6 w-6 place-items-center rounded-md bg-gray-950 text-xs font-bold text-white dark:bg-white dark:text-gray-950">W</span>
        <LogIn size={17} aria-hidden="true" />
        {mode === 'signup' ? 'Продолжить через социальный аккаунт' : 'Войти через социальный аккаунт'}
      </button>
      <div className="my-4 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
        <span className="text-xs text-gray-500 dark:text-gray-400">или по email</span>
        <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
      </div>
    </div>
  );
}
