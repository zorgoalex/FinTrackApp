import { createContext, useContext, useState, useEffect } from 'react';
import { createClient } from "@supabase/supabase-js";

const AuthContext = createContext({});

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    // Получаем текущую сессию
    const getInitialSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session?.user) {
        const profile = { id: session.user.id, email: session.user.email };
        localStorage.setItem("user", JSON.stringify(profile));
        setUser(profile);
      }
      setLoading(false);
    };
    
    getInitialSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      const supaUser = session?.user || null;
      if (supaUser) {
        const profile = { id: supaUser.id, email: supaUser.email };
        localStorage.setItem("user", JSON.stringify(profile));
        setUser(profile);
      } else {
        localStorage.removeItem("user");
        setUser(null);
      }
      setLoading(false);
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  const login = async (email, password) => {
    setError("");
    if (!password || password.length < 6) {
      setError("Пароль должен быть не менее 6 символов");
      return false;
    }
    setLoading(true);
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) throw authError;
      const supaUser = data.user;
      if (!supaUser) throw new Error("Не удалось получить данные пользователя");
      const profile = { id: supaUser.id, email: supaUser.email };
      localStorage.setItem("user", JSON.stringify(profile));
      setUser(profile);
      return true;
    } catch (e) {
      setError(e.message || "Ошибка входа");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const signUp = async (name, email, password) => {
    setError("");
    if (!password || password.length < 6) {
      setError("Пароль должен быть не менее 6 символов");
      return false;
    }
    setLoading(true);
    try {
      const { error: signErr } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name } }
      });
      if (signErr) throw signErr;
      return true;
    } catch (e) {
      setError(e.message || "Ошибка регистрации");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem("user");
    setUser(null);
  };

  const value = {
    user,
    login,
    logout,
    signUp,
    loading,
    error,
    isAuthenticated: !!user
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
