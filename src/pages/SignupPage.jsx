import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export default function SignupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signUp, loading, error } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError("");
    if (!password || password.length < 6) {
      setLocalError("Пароль должен быть не менее 6 символов");
      return;
    }
    const ok = await signUp(name, email, password);
    if (ok) {
      const from = location.state?.from;
      navigate(from ? from.pathname + (from.search || "") : "/workspaces", { replace: true });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50 dark:bg-gray-900">
      <div className="card w-full max-w-sm">
        <div className="text-center mb-6"><h1 className="text-2xl font-bold text-primary-600 dark:text-primary-400">ФинУчёт</h1></div>
        <h2 className="text-xl font-semibold mb-4">Регистрация</h2>
        {(error || localError) && (
          <div className="text-red-600 dark:text-red-400 text-sm mb-3">{error || localError}</div>
        )}
        <form onSubmit={handleSubmit} className="space-y-3">
          <input type="text" className="input-field" placeholder="Имя" value={name} onChange={(e)=>setName(e.target.value)} required />
          <input type="email" className="input-field" placeholder="Email" value={email} onChange={(e)=>setEmail(e.target.value)} required />
          <input type="password" className="input-field" placeholder="Пароль" value={password} onChange={(e)=>setPassword(e.target.value)} required />
          <button className="btn-primary w-full" disabled={loading}>
            {loading ? "Создаём..." : "Зарегистрироваться"}
          </button>
        </form>
        <div className="mt-4 text-sm text-center text-gray-600 dark:text-gray-400">
          Уже есть аккаунт? <Link to="/login" className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300">Войти</Link>
        </div>
      </div>
    </div>
  );
}
