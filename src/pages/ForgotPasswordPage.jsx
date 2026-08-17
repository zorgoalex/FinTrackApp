import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import AuthShell from '../components/AuthShell';
import TurnstileWidget, { isTurnstileEnabled, TURNSTILE_REQUIRED_MESSAGE } from '../components/TurnstileWidget';

export default function ForgotPasswordPage() {
  const { requestPasswordReset, loading, error } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const [localError, setLocalError] = useState('');
  const turnstileRef = useRef(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLocalError('');
    if (isTurnstileEnabled && !captchaToken) {
      setLocalError(TURNSTILE_REQUIRED_MESSAGE);
      return;
    }
    const ok = await requestPasswordReset(email.trim(), captchaToken);
    setCaptchaToken('');
    turnstileRef.current?.reset();
    if (ok) setSent(true);
  };

  return (
    <AuthShell eyebrow="Безопасность" title="Восстановление пароля" subtitle="Получите ссылку для создания нового пароля.">
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          Укажите email аккаунта — мы отправим ссылку для создания нового пароля.
        </p>
        {sent ? (
          <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/30 dark:text-green-300">
            Если аккаунт с таким email существует, письмо для восстановления уже отправлено.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            {(error || localError) && <div className="text-sm text-red-600 dark:text-red-400">{error || localError}</div>}
            <input
              type="email"
              className="input-field"
              placeholder="Email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
            <TurnstileWidget
              ref={turnstileRef}
              action="password_reset"
              onTokenChange={setCaptchaToken}
              onError={setLocalError}
            />
            <button className="btn-primary min-h-11 w-full" disabled={loading}>
              {loading ? 'Отправляем...' : 'Отправить ссылку'}
            </button>
          </form>
        )}
        <div className="mt-4 text-center text-sm">
          <Link to="/login" className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300">
            Вернуться ко входу
          </Link>
        </div>
    </AuthShell>
  );
}
