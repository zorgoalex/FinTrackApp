import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from "../contexts/AuthContext";
import AuthShell from '../components/AuthShell';
import PasswordInput from '../components/PasswordInput';
import SocialAuthButtons from '../components/SocialAuthButtons';
import TurnstileWidget, { isTurnstileEnabled, TURNSTILE_REQUIRED_MESSAGE } from '../components/TurnstileWidget';
import { INTERNET_REQUIRED_MESSAGE } from '../utils/connectivity';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, loading, error, online, user } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState("");
  const [captchaToken, setCaptchaToken] = useState('');
  const turnstileRef = useRef(null);
  const from = location.state?.from;
  const destination = from ? from.pathname + (from.search || '') : '/workspaces';

  useEffect(() => {
    if (online && user) navigate(destination, { replace: true });
  }, [destination, navigate, online, user]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError("");
    if (!online) {
      setLocalError(INTERNET_REQUIRED_MESSAGE);
      return;
    }
    if (!password || password.length < 8) {
      setLocalError("Пароль должен быть не менее 8 символов");
      return;
    }
    if (isTurnstileEnabled && !captchaToken) {
      setLocalError(TURNSTILE_REQUIRED_MESSAGE);
      return;
    }
    try {
      const ok = await login(identifier, password, captchaToken);
      setCaptchaToken('');
      turnstileRef.current?.reset();
      if (ok) {
        navigate(destination, { replace: true });
      }
    } catch {
      setCaptchaToken('');
      turnstileRef.current?.reset();
    }
  };

  return (
    <AuthShell eyebrow="С возвращением" title="Войдите в ФинУчёт" subtitle="Продолжите работу со своими бюджетами и пространствами.">
        {!online && (
          <div role="alert" className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {INTERNET_REQUIRED_MESSAGE}. Вход станет доступен после восстановления соединения.
          </div>
        )}
        {(error || localError) && online && (
          <div className="text-red-600 dark:text-red-400 text-sm mb-3">{error || localError}</div>
        )}
        <SocialAuthButtons mode="login" disabled={!online} />
        <form onSubmit={handleSubmit} className="space-y-3">
          <input type="text" className="input-field" placeholder="Email или логин" value={identifier} onChange={(e)=>setIdentifier(e.target.value)} autoComplete="username" required />
          <PasswordInput placeholder="Пароль" value={password} onChange={(e)=>setPassword(e.target.value)} autoComplete="current-password" required />
          <TurnstileWidget
            ref={turnstileRef}
            action="login"
            onTokenChange={setCaptchaToken}
            onError={setLocalError}
          />
          <button className="btn-primary min-h-11 w-full" disabled={loading || !online}>
            {!online ? "Нет соединения" : loading ? "Входим..." : "Войти"}
          </button>
        </form>
        <div className="mt-3 text-center text-sm">
          <Link to="/forgot-password" className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300">
            Забыли пароль?
          </Link>
        </div>
        <div className="mt-4 text-sm text-center text-gray-600 dark:text-gray-400">
          Нет аккаунта? <Link to="/signup" className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300">Зарегистрируйтесь</Link>
        </div>
    </AuthShell>
  );
}
