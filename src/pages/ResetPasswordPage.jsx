import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import AuthShell from '../components/AuthShell';

export default function ResetPasswordPage() {
  const { updatePassword, loading, error } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [localError, setLocalError] = useState('');
  const [updated, setUpdated] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLocalError('');
    if (password.length < 6) {
      setLocalError('Пароль должен быть не менее 6 символов');
      return;
    }
    if (password !== confirmation) {
      setLocalError('Пароли не совпадают');
      return;
    }
    const ok = await updatePassword(password);
    if (ok) setUpdated(true);
  };

  return (
    <AuthShell eyebrow="Безопасность" title="Новый пароль" subtitle="Придумайте пароль длиной не менее шести символов.">
        {updated ? (
          <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/30 dark:text-green-300">
            Пароль изменён. Теперь можно войти с новым паролем.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            {(error || localError) && (
              <div className="text-sm text-red-600 dark:text-red-400">{error || localError}</div>
            )}
            <input
              type="password"
              className="input-field"
              placeholder="Новый пароль"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
            />
            <input
              type="password"
              className="input-field"
              placeholder="Повторите пароль"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
            />
            <button className="btn-primary min-h-11 w-full" disabled={loading}>
              {loading ? 'Сохраняем...' : 'Сохранить пароль'}
            </button>
          </form>
        )}
        <div className="mt-4 text-center text-sm">
          <Link to="/login" className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300">
            Перейти ко входу
          </Link>
        </div>
    </AuthShell>
  );
}
