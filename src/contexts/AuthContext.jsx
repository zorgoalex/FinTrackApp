import { createContext, useCallback, useContext, useState, useEffect, useRef } from 'react';
import { createClient } from "@supabase/supabase-js";
import MfaChallengeForm from '../components/MfaChallengeForm';
import PasswordStepUpForm from '../components/PasswordStepUpForm';
import { isTurnstileEnabled, TURNSTILE_REQUIRED_MESSAGE } from '../components/TurnstileWidget';
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from '../utils/passwordPolicy';
import { clearLocalFinancialData } from '../utils/offlineStore';
import { INTERNET_REQUIRED_MESSAGE, isInternetAvailable } from '../utils/connectivity';
import { getVerifiedTotpFactors, hasFreshPassword, hasFreshTotpAal2 } from '../utils/mfa';

const AuthContext = createContext({});

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const workosConnectionId = import.meta.env.VITE_WORKOS_CONNECTION_ID?.trim();
const workosEnabled = import.meta.env.VITE_WORKOS_AUTH_ENABLED === 'true' && Boolean(workosConnectionId);
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

function friendlyAuthError(error, fallback) {
  const message = String(error?.message || '');
  if (/captcha|turnstile|challenge/i.test(message)) {
    return 'Не удалось пройти проверку безопасности. Обновите проверку и попробуйте ещё раз.';
  }
  return message || fallback;
}

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
  const [aal2Request, setAal2Request] = useState(null);
  const [passwordRequest, setPasswordRequest] = useState(null);
  const activeUserIdRef = useRef(readStoredUserId());
  const pendingAal2Ref = useRef(null);
  const pendingPasswordRef = useRef(null);

  const finishAal2Request = useCallback((result) => {
    pendingAal2Ref.current?.resolve(result);
    pendingAal2Ref.current = null;
    setAal2Request(null);
  }, []);

  const requireTotpVerification = useCallback(async (reason = 'Это действие требует дополнительного подтверждения') => {
    if (!isInternetAvailable()) throw new Error(INTERNET_REQUIRED_MESSAGE);

    const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError) throw assuranceError;
    if (hasFreshTotpAal2(assurance)) return true;

    const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors();
    if (factorsError) throw factorsError;
    const factor = getVerifiedTotpFactors(factorsData?.all)[0];
    if (!factor) {
      const enrollmentError = new Error('Сначала подключите TOTP в личном кабинете');
      enrollmentError.code = 'MFA_ENROLLMENT_REQUIRED';
      throw enrollmentError;
    }

    if (pendingAal2Ref.current) finishAal2Request(false);
    return new Promise((resolve) => {
      pendingAal2Ref.current = { resolve };
      setAal2Request({ reason, factorId: factor.id, busy: false, error: '' });
    });
  }, [finishAal2Request]);

  const verifyAal2Request = useCallback(async (code) => {
    if (!aal2Request?.factorId) return;
    setAal2Request((current) => ({ ...current, busy: true, error: '' }));
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId: aal2Request.factorId,
      code,
    });
    if (verifyError) {
      setAal2Request((current) => ({ ...current, busy: false, error: 'Код не подошёл. Проверьте его и попробуйте ещё раз.' }));
      return;
    }
    finishAal2Request(true);
  }, [aal2Request?.factorId, finishAal2Request]);

  const finishPasswordRequest = useCallback((result) => {
    pendingPasswordRef.current?.resolve(result);
    pendingPasswordRef.current = null;
    setPasswordRequest(null);
  }, []);

  const requireFreshPassword = useCallback(async (reason = 'Это действие требует повторного ввода текущего пароля') => {
    if (!isInternetAvailable()) throw new Error(INTERNET_REQUIRED_MESSAGE);

    const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError) throw assuranceError;
    if (hasFreshPassword(assurance)) return true;

    if (pendingPasswordRef.current) finishPasswordRequest(false);
    return new Promise((resolve) => {
      pendingPasswordRef.current = { resolve };
      setPasswordRequest({ reason, busy: false, error: '' });
    });
  }, [finishPasswordRequest]);

  const verifyPasswordRequest = useCallback(async (password, captchaToken) => {
    if (!user?.email) return;
    if (isTurnstileEnabled && !captchaToken) {
      setPasswordRequest((current) => ({ ...current, busy: false, error: TURNSTILE_REQUIRED_MESSAGE }));
      return;
    }
    setPasswordRequest((current) => ({ ...current, busy: true, error: '' }));
    const { error: verificationError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password,
      options: { captchaToken },
    });
    if (verificationError) {
      setPasswordRequest((current) => ({
        ...current,
        busy: false,
        error: /captcha|turnstile|challenge/i.test(String(verificationError.message || ''))
          ? friendlyAuthError(verificationError, 'Не удалось подтвердить пароль')
          : 'Текущий пароль неверен.',
      }));
      return;
    }
    finishPasswordRequest(true);
  }, [finishPasswordRequest, user?.email]);

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
      pendingAal2Ref.current?.resolve(false);
      pendingAal2Ref.current = null;
      pendingPasswordRef.current?.resolve(false);
      pendingPasswordRef.current = null;
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

  const login = async (identifier, password, captchaToken) => {
    setError("");
    if (!requireInternet()) return false;
    if (!password || password.length < 8) {
      setError("Пароль должен быть не менее 8 символов");
      return false;
    }
    if (isTurnstileEnabled && !captchaToken) {
      setError(TURNSTILE_REQUIRED_MESSAGE);
      return false;
    }
    setLoading(true);
    try {
      let data;
      if (identifier.includes('@')) {
        const result = await supabase.auth.signInWithPassword({
          email: identifier.trim(),
          password,
          options: { captchaToken },
        });
        if (result.error) throw result.error;
        data = result.data;
      } else {
        const { data: loginData, error: invokeError } = await supabase.functions.invoke('login-user', {
          body: { identifier: identifier.trim(), password, captchaToken }
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
      setError(friendlyAuthError(e, "Ошибка входа"));
      return false;
    } finally {
      setLoading(false);
    }
  };

  const signUp = async (username, email, password, captchaToken) => {
    setError("");
    if (!requireInternet()) return { success: false, requiresEmailConfirmation: false };
    if (!isStrongPassword(password)) {
      setError(PASSWORD_POLICY_MESSAGE);
      return false;
    }
    if (isTurnstileEnabled && !captchaToken) {
      setError(TURNSTILE_REQUIRED_MESSAGE);
      return { success: false, requiresEmailConfirmation: false };
    }
    setLoading(true);
    try {
      const { data, error: signErr } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name: username, username },
          emailRedirectTo: window.location.origin,
          captchaToken
        }
      });
      if (signErr) throw signErr;
      return {
        success: true,
        requiresEmailConfirmation: !data.session
      };
    } catch (e) {
      setError(friendlyAuthError(e, "Ошибка регистрации"));
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

  const requestPasswordReset = async (email, captchaToken) => {
    setError("");
    if (!requireInternet()) return false;
    if (isTurnstileEnabled && !captchaToken) {
      setError(TURNSTILE_REQUIRED_MESSAGE);
      return false;
    }
    setLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
        captchaToken
      });
      if (resetError) throw resetError;
      return true;
    } catch (e) {
      setError(friendlyAuthError(e, "Не удалось отправить письмо для восстановления пароля"));
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

  const updateEmail = async (email) => {
    setError('');
    if (!requireInternet()) return false;
    try {
      const confirmed = await requireFreshPassword('Смена email требует повторного ввода текущего пароля');
      if (!confirmed) return false;
      const { error: updateError } = await supabase.auth.updateUser({ email: email.trim() });
      if (updateError) throw updateError;
      return true;
    } catch (updateError) {
      setError(updateError.message || 'Не удалось изменить email');
      return false;
    }
  };

  const logout = async () => {
    if (pendingAal2Ref.current) finishAal2Request(false);
    if (pendingPasswordRef.current) finishPasswordRequest(false);
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
    updateEmail,
    requireTotpVerification,
    requireFreshPassword,
    loading,
    error,
    online,
    isAuthenticated: !!user
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
      {aal2Request && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Подтверждение двухфакторной аутентификации">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-800">
            <MfaChallengeForm
              title="Дополнительное подтверждение"
              description={aal2Request.reason}
              busy={aal2Request.busy}
              error={aal2Request.error}
              onVerify={verifyAal2Request}
              onCancel={() => finishAal2Request(false)}
            />
          </div>
        </div>
      )}
      {passwordRequest && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Повторное подтверждение текущего пароля">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-800">
            <PasswordStepUpForm
              reason={passwordRequest.reason}
              busy={passwordRequest.busy}
              error={passwordRequest.error}
              onVerify={verifyPasswordRequest}
              onCancel={() => finishPasswordRequest(false)}
            />
          </div>
        </div>
      )}
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
