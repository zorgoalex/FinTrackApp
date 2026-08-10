import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { createClient } from "@supabase/supabase-js";
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from '../utils/passwordPolicy';
import { clearLocalFinancialData } from '../utils/offlineStore';
import { INTERNET_REQUIRED_MESSAGE, isInternetAvailable } from '../utils/connectivity';

const AuthContext = createContext({});

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const workosConnectionId = import.meta.env.VITE_WORKOS_CONNECTION_ID?.trim();
const workosEnabled = import.meta.env.VITE_WORKOS_AUTH_ENABLED === 'true' && Boolean(workosConnectionId);
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

function readStoredUserId() {
  if (typeof localStorage === 'undefined') return null;
  try {
    return JSON.parse(localStorage.getItem('user'))?.id || null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(() => isInternetAvailable());
  const activeUserIdRef = useRef(readStoredUserId());

  useEffect(() => {
    let active = true;

    const applySession = async (session) => {
      if (!active) return;
      if (!isInternetAvailable()) {
        setOnline(false);
        localStorage.removeItem('user');
        activeUserIdRef.current = null;
        setUser(null);
        return;
      }

      setOnline(true);
      const nextUserId = session?.user?.id || null;
      const previousUserId = activeUserIdRef.current;
      if (previousUserId && previousUserId !== nextUserId) {
        await clearLocalFinancialData();
      }
      activeUserIdRef.current = nextUserId;

      if (session?.user) {
        const profile = { id: session.user.id, email: session.user.email };
        localStorage.setItem('user', JSON.stringify(profile));
        setUser(profile);
      } else {
        localStorage.removeItem('user');
        setUser(null);
      }
    };

    const restoreSession = async () => {
      if (!isInternetAvailable()) {
        await clearLocalFinancialData().catch(() => undefined);
        if (!active) return;
        setOnline(false);
        localStorage.removeItem('user');
        activeUserIdRef.current = null;
        setUser(null);
        setLoading(false);
        return;
      }

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          await applySession(null);
          return;
        }

        // getSession() can read a cached token without touching the network.
        // Require a successful Auth server response before restoring the user.
        const { data: { user: verifiedUser }, error: verificationError } = await supabase.auth.getUser();
        if (verificationError || !verifiedUser) {
          throw verificationError || new Error('Не удалось проверить сессию');
        }
        await applySession({ ...session, user: verifiedUser });
      } catch (sessionError) {
        console.error('AuthContext: initial session error', sessionError);
        if (!active) return;
        localStorage.removeItem('user');
        activeUserIdRef.current = null;
        setUser(null);
        if (!isInternetAvailable() || /fetch|network|load failed/i.test(String(sessionError?.message || sessionError))) {
          setOnline(false);
          setError(INTERNET_REQUIRED_MESSAGE);
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    clearLocalFinancialData().catch((cleanupError) => {
      console.error('AuthContext: legacy offline data cleanup failed', cleanupError);
    });
    restoreSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      // INITIAL_SESSION is local state and is handled by restoreSession(),
      // which verifies it against the Auth server before exposing the user.
      if (event === 'INITIAL_SESSION') return;
      await applySession(session);
      if (active) setLoading(false);
    });

    const handleOffline = () => {
      setOnline(false);
      setLoading(false);
      localStorage.removeItem('user');
      activeUserIdRef.current = null;
      setUser(null);
      clearLocalFinancialData().catch((cleanupError) => {
        console.error('AuthContext: offline cleanup failed', cleanupError);
      });
    };

    const handleOnline = () => {
      setOnline(true);
      setError('');
      setLoading(true);
      restoreSession();
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  const requireInternet = () => {
    if (isInternetAvailable()) return true;
    setOnline(false);
    setError(INTERNET_REQUIRED_MESSAGE);
    return false;
  };

  const login = async (identifier, password) => {
    setError("");
    if (!requireInternet()) return false;
    if (!password || password.length < 8) {
      setError("Пароль должен быть не менее 8 символов");
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
    if (!requireInternet()) return { success: false, requiresEmailConfirmation: false };
    if (!isStrongPassword(password)) {
      setError(PASSWORD_POLICY_MESSAGE);
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
    if (!requireInternet()) return false;
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
    if (!requireInternet()) return false;
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

  const updatePassword = async (password, currentPassword) => {
    setError("");
    if (!requireInternet()) return false;
    if (!isStrongPassword(password)) {
      setError(PASSWORD_POLICY_MESSAGE);
      return false;
    }
    setLoading(true);
    try {
      const attributes = currentPassword
        ? { password, current_password: currentPassword }
        : { password };
      const { error: updateError } = await supabase.auth.updateUser(attributes);
      if (updateError) throw updateError;
      if (currentPassword) await supabase.auth.signOut({ scope: 'others' });
      return true;
    } catch (e) {
      setError(e.message || "Не удалось изменить пароль");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    const userId = activeUserIdRef.current || user?.id || readStoredUserId();
    let signOutError = null;
    try {
      const result = await supabase.auth.signOut();
      signOutError = result.error;
    } finally {
      await clearLocalFinancialData(userId).catch((cleanupError) => {
        console.error('AuthContext: local financial data cleanup failed', cleanupError);
      });
      localStorage.removeItem("user");
      activeUserIdRef.current = null;
      setUser(null);
    }
    if (signOutError) throw signOutError;
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
    online,
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
