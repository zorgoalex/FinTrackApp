import { useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from "../contexts/AuthContext";
import AuthShell from '../components/AuthShell';
import SocialAuthButtons from '../components/SocialAuthButtons';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, loading, error } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError("");
    if (!password || password.length < 6) {
      setLocalError("Пароль должен быть не менее 6 символов");
      return;
    }
    const ok = await login(identifier, password);
    if (ok) {
      const from = location.state?.from;
      navigate(from ? from.pathname + (from.search || "") : "/workspaces", { replace: true });
    }
  };

  return (
    <AuthShell eyebrow="С возвращением" title="Войдите в ФинУчёт" subtitle="Продолжите работу со своими бюджетами и пространствами.">
        {(error || localError) && (
          <div className="text-red-600 dark:text-red-400 text-sm mb-3">{error || localError}</div>
        )}
        <SocialAuthButtons mode="login" />
        <form onSubmit={handleSubmit} className="space-y-3">
          <input type="text" className="input-field" placeholder="Email или имя аккаунта" value={identifier} onChange={(e)=>setIdentifier(e.target.value)} autoComplete="username" required />
          <input type="password" className="input-field" placeholder="Пароль" value={password} onChange={(e)=>setPassword(e.target.value)} required />
          <button className="btn-primary min-h-11 w-full" disabled={loading}>
            {loading ? "Входим..." : "Войти"}
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
