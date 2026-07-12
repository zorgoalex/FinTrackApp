import { createContext, useContext, useState, useEffect } from 'react';
import { createClient } from "@supabase/supabase-js";

const AuthContext = createContext({});

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const workosConnectionId = import.meta.env.VITE_WORKOS_CONNECTION_ID?.trim();
const workosEnabled = import.meta.env.VITE_WORKOS_AUTH_ENABLED === 'true' && Boolean(workosConnectionId);
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

  const login = async (identifier, password) => {
    setError("");
    if (!password || password.length < 6) {
      setError("Пароль должен быть не менее 6 символов");
      return false;
    }
    setLoading(true);
    try {
      let data;
      if (identifier.includes('@')) {
        const result = await supabase.auth.signInWithPassword({ email: identifier.trim(), password });
        if (result.error) throw result.error;
        data = result.data;
      } else {
        const { data: loginData, error: invokeError } = await supabase.functions.invoke('login-user', {
          body: { identifier: identifier.trim(), password }
        });
        if (invokeError || loginData?.error) throw new Error(loginData?.error || 'Ошибка входа');
        const sessionResult = await supabase.auth.setSession({
          access_token: loginData.access_token,
          refresh_token: loginData.refresh_token
        });
        if (sessionResult.error) throw sessionResult.error;
        data = sessionResult.data;
      }
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

  const signUp = async (username, email, password) => {
    setError("");
    if (!password || password.length < 6) {
      setError("Пароль должен быть не менее 6 символов");
      return false;
    }
    setLoading(true);
    try {
      const { data, error: signErr } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name: username, username },
          emailRedirectTo: window.location.origin
        }
      });
      if (signErr) throw signErr;
      return {
        success: true,
        requiresEmailConfirmation: !data.session
      };
    } catch (e) {
      setError(e.message || "Ошибка регистрации");
      return { success: false, requiresEmailConfirmation: false };
    } finally {
      setLoading(false);
    }
  };

  const loginWithWorkOS = async () => {
    setError('');
    if (!workosEnabled) {
      setError('Вход через социальные аккаунты пока не настроен');
      return false;
    }
    setLoading(true);
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'workos',
        options: {
          redirectTo: `${window.location.origin}/workspaces`,
          queryParams: { connection: workosConnectionId },
        },
      });
      if (oauthError) throw oauthError;
      return true;
    } catch (oauthException) {
      setError(oauthException.message || 'Не удалось начать вход через социальный аккаунт');
      setLoading(false);
      return false;
    }
  };

  const requestPasswordReset = async (email) => {
    setError("");
    setLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`
      });
      if (resetError) throw resetError;
      return true;
    } catch (e) {
      setError(e.message || "Не удалось отправить письмо для восстановления пароля");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const updatePassword = async (password) => {
    setError("");
    if (!password || password.length < 6) {
      setError("Пароль должен быть не менее 6 символов");
      return false;
    }
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      return true;
    } catch (e) {
      setError(e.message || "Не удалось изменить пароль");
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
    loginWithWorkOS,
    workosEnabled,
    requestPasswordReset,
    updatePassword,
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
