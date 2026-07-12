import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import AuthShell from '../components/AuthShell';
import SocialAuthButtons from '../components/SocialAuthButtons';

export default function SignupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signUp, loading, error } = useAuth();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState("");
  const [confirmationSent, setConfirmationSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError("");
    if (!password || password.length < 6) {
      setLocalError("Пароль должен быть не менее 6 символов");
      return;
    }
    if (!/^[\p{L}\p{N}_]{3,21}$/u.test(username)) {
      setLocalError("Имя аккаунта: 3–21 символ, только буквы, цифры и _");
      return;
    }
    const result = await signUp(username, email, password);
    if (result.success && result.requiresEmailConfirmation) {
      setConfirmationSent(true);
      return;
    }
    if (result.success) {
      const from = location.state?.from;
      navigate(from ? from.pathname + (from.search || "") : "/workspaces", { replace: true });
    }
  };

  return (
    <AuthShell eyebrow="Новый аккаунт" title="Начните вести финансы" subtitle="Создайте безопасное пространство для личного бюджета или небольшой команды.">
        {confirmationSent && (
          <div className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/30 dark:text-green-300">
            Регистрация завершена. Проверьте почту и подтвердите email, затем войдите в приложение.
          </div>
        )}
        {(error || localError) && !confirmationSent && (
          <div className="text-red-600 dark:text-red-400 text-sm mb-3">{error || localError}</div>
        )}
        {!confirmationSent && <SocialAuthButtons mode="signup" />}
        {!confirmationSent && <form onSubmit={handleSubmit} className="space-y-3">
          <input type="text" className="input-field" placeholder="Имя аккаунта" value={username} onChange={(e)=>setUsername(e.target.value)} autoComplete="username" minLength={3} maxLength={21} required />
          <input type="email" className="input-field" placeholder="Email" value={email} onChange={(e)=>setEmail(e.target.value)} required />
          <input type="password" className="input-field" placeholder="Пароль" value={password} onChange={(e)=>setPassword(e.target.value)} required />
          <button className="btn-primary min-h-11 w-full" disabled={loading}>
            {loading ? "Создаём..." : "Зарегистрироваться"}
          </button>
        </form>}
        <div className="mt-4 text-sm text-center text-gray-600 dark:text-gray-400">
          Уже есть аккаунт? <Link to="/login" className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300">Войти</Link>
        </div>
    </AuthShell>
  );
}
