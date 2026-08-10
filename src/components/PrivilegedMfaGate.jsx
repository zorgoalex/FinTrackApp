import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { supabase, useAuth } from '../contexts/AuthContext';
import { getVerifiedTotpFactors, hasTotpAal2 } from '../utils/mfa';
import MfaChallengeForm from './MfaChallengeForm';
import MfaEnrollmentForm from './MfaEnrollmentForm';

const enforcementEnabled = import.meta.env.VITE_PRIVILEGED_MFA_ENFORCEMENT !== 'false';

export default function PrivilegedMfaGate({ children }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [state, setState] = useState({ loading: enforcementEnabled, privileged: false, assurance: null, factors: [], error: '' });
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyError, setVerifyError] = useState('');

  const refresh = useCallback(async () => {
    if (!enforcementEnabled || !user?.id) {
      setState({ loading: false, privileged: false, assurance: null, factors: [], error: '' });
      return;
    }
    setState((current) => ({ ...current, loading: true, error: '' }));
    const [{ data: privileged, error: membershipError }, { data: factorsData, error: factorsError }, { data: assurance, error: assuranceError }] = await Promise.all([
      supabase.rpc('current_user_requires_workspace_mfa'),
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);
    const loadError = membershipError || factorsError || assuranceError;
    if (loadError) {
      setState({ loading: false, privileged: false, assurance: null, factors: [], error: loadError.message || 'Не удалось проверить двухфакторную защиту' });
      return;
    }
    setState({
      loading: false,
      privileged: Boolean(privileged),
      assurance,
      factors: getVerifiedTotpFactors(factorsData?.all),
      error: '',
    });
  }, [location.pathname, location.search, user?.id]);

  useEffect(() => {
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  if (!enforcementEnabled) return children;

  if (state.loading) {
    return <div className="min-h-screen grid place-items-center bg-gray-50 p-4 text-gray-600 dark:bg-gray-900 dark:text-gray-300">Проверяем двухфакторную защиту…</div>;
  }

  if (state.error) {
    return (
      <div className="min-h-screen grid place-items-center bg-gray-50 p-4 dark:bg-gray-900">
        <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-sm dark:bg-gray-800">
          <h1 className="font-semibold text-gray-950 dark:text-white">Не удалось проверить TOTP</h1>
          <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{state.error}</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => logout()} className="btn-secondary min-h-11">Выйти</button>
            <button type="button" onClick={refresh} className="btn-primary min-h-11">Повторить</button>
          </div>
        </div>
      </div>
    );
  }

  if (!state.privileged) return children;

  if (hasTotpAal2(state.assurance)) return children;

  const verify = async (code) => {
    setVerifyBusy(true);
    setVerifyError('');
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: state.factors[0].id, code });
    setVerifyBusy(false);
    if (error) {
      setVerifyError('Код не подошёл. Проверьте его и попробуйте ещё раз.');
      return;
    }
    await refresh();
  };

  return (
    <div className="min-h-screen grid place-items-center bg-gray-50 p-4 dark:bg-gray-900">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-sm dark:bg-gray-800">
        <div className="mb-4 flex items-center gap-2 text-primary-600 dark:text-primary-300"><ShieldCheck size={22} /><span className="text-sm font-semibold">Защита привилегированного аккаунта</span></div>
        {state.factors.length === 0 ? (
          <MfaEnrollmentForm mandatory onVerified={refresh} />
        ) : (
          <MfaChallengeForm
            title="Введите код TOTP"
            description="Для владельцев и администраторов вход завершается только после второго фактора."
            busy={verifyBusy}
            error={verifyError}
            onVerify={verify}
          />
        )}
        <button type="button" onClick={() => logout()} className="mt-3 min-h-11 w-full text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">Выйти из аккаунта</button>
      </div>
    </div>
  );
}
