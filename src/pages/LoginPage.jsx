import { useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from "../contexts/AuthContext";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, loading, error } = useAuth();
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
    const ok = await login(email, password);
    if (ok) {
      const from = location.state?.from;
      navigate(from ? from.pathname + (from.search || "") : "/workspaces", { replace: true });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card w-full max-w-sm">
        <h1 className="text-xl font-semibold mb-4">Вход</h1>
        {(error || localError) && (
          <div className="text-red-600 text-sm mb-3">{error || localError}</div>
        )}
        <form onSubmit={handleSubmit} className="space-y-3">
          <input type="email" className="input" placeholder="Email" value={email} onChange={(e)=>setEmail(e.target.value)} required />
          <input type="password" className="input" placeholder="Пароль" value={password} onChange={(e)=>setPassword(e.target.value)} required />
          <button className="btn btn-primary w-full" disabled={loading}>
            {loading ? "Входим..." : "Войти"}
          </button>
        </form>
        <div className="mt-4 text-sm text-center">
          Нет аккаунта? <Link to="/signup" className="text-blue-600">Зарегистрируйтесь</Link>
        </div>
      </div>
    </div>
  );
}
