import { useCallback, useEffect, useState } from 'react';
import { Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { supabase, useAuth } from '../contexts/AuthContext';
import { getVerifiedTotpFactors } from '../utils/mfa';
import MfaEnrollmentForm from './MfaEnrollmentForm';

export default function MfaSettings() {
  const { user, requireAal2 } = useAuth();
  const [state, setState] = useState({ loading: true, factors: [], privileged: false, error: '', message: '' });
  const [enrolling, setEnrolling] = useState(false);
  const [removingId, setRemovingId] = useState(null);

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '', message: '' }));
    const [{ data: factorsData, error: factorsError }, { data: privileged, error: membershipError }] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.rpc('current_user_requires_workspace_mfa'),
    ]);
    const loadError = factorsError || membershipError;
    setState({
      loading: false,
      factors: getVerifiedTotpFactors(factorsData?.all),
      privileged: Boolean(privileged),
      error: loadError?.message || '',
      message: '',
    });
  }, [user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  const removeFactor = async (factor) => {
    setState((current) => ({ ...current, error: '', message: '' }));
    if (state.privileged && state.factors.length === 1) {
      setState((current) => ({ ...current, error: 'Последний TOTP нельзя удалить, пока аккаунт является владельцем или администратором.' }));
      return;
    }
    try {
      const confirmed = await requireAal2('Отключение TOTP требует свежего кода из приложения-аутентификатора');
      if (!confirmed) return;
      setRemovingId(factor.id);
      const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
      if (error) throw error;
      await refresh();
      setState((current) => ({ ...current, message: 'TOTP-фактор удалён.' }));
    } catch (removeError) {
      setState((current) => ({ ...current, error: removeError.message || 'Не удалось удалить TOTP-фактор' }));
    } finally {
      setRemovingId(null);
    }
  };

  if (enrolling) {
    return <MfaEnrollmentForm onCancel={() => setEnrolling(false)} onVerified={async () => { setEnrolling(false); await refresh(); setState((current) => ({ ...current, message: 'TOTP успешно подключён.' })); }} />;
  }

  return (
    <div>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300"><ShieldCheck size={20} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Двухфакторная защита</h2>
          <p className="mt-1 text-sm text-gray-500">Одноразовые коды TOTP защищают вход и критические действия.</p>
        </div>
      </div>
      {state.loading ? <p className="mt-3 text-sm text-gray-500">Проверяем факторы…</p> : (
        <div className="mt-3 space-y-2">
          {state.factors.length === 0 ? (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">TOTP пока не подключён.{state.privileged ? ' Для владельца или администратора он обязателен.' : ''}</p>
          ) : state.factors.map((factor, index) => (
            <div key={factor.id} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <div className="min-w-0"><p className="truncate text-sm font-medium">{factor.friendly_name || `Аутентификатор ${index + 1}`}</p><p className="text-xs text-green-600">Подключён и проверен</p></div>
              <button type="button" onClick={() => removeFactor(factor)} disabled={removingId === factor.id || (state.privileged && state.factors.length === 1)} className="btn-secondary min-h-11 min-w-11 p-2 text-red-600 disabled:opacity-40" aria-label="Удалить TOTP-фактор"><Trash2 size={16} /></button>
            </div>
          ))}
          <button type="button" onClick={() => setEnrolling(true)} className="btn-secondary flex min-h-11 w-full items-center justify-center gap-2"><Plus size={16} /> Добавить аутентификатор</button>
        </div>
      )}
      {state.error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{state.error}</p>}
      {state.message && <p role="status" className="mt-3 text-sm text-green-600">{state.message}</p>}
    </div>
  );
}
