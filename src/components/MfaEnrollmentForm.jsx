import { useEffect, useState } from 'react';
import { Copy, QrCode } from 'lucide-react';
import { supabase } from '../contexts/AuthContext';
import { normalizeTotpCode, totpQrCodeDataUrl } from '../utils/mfa';

export default function MfaEnrollmentForm({ onVerified, onCancel }) {
  const [enrollment, setEnrollment] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    const enroll = async () => {
      setBusy(true);
      setError('');
      const { data: factorsData } = await supabase.auth.mfa.listFactors();
      const unverified = (factorsData?.all || []).filter((factor) => factor.factor_type === 'totp' && factor.status === 'unverified');
      await Promise.all(unverified.map((factor) => supabase.auth.mfa.unenroll({ factorId: factor.id })));
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        issuer: 'FinTrackApp',
        friendlyName: `FinTrackApp ${new Date().toLocaleDateString('ru-RU')}`,
      });
      if (!active) return;
      if (enrollError) setError(enrollError.message || 'Не удалось начать подключение TOTP');
      else setEnrollment(data);
      setBusy(false);
    };
    enroll();
    return () => { active = false; };
  }, []);

  const verify = async (event) => {
    event.preventDefault();
    if (!enrollment?.id || code.length !== 6) return;
    setBusy(true);
    setError('');
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrollment.id, code });
    setBusy(false);
    if (verifyError) {
      setError('Код не подошёл. Проверьте время на телефоне и попробуйте ещё раз.');
      return;
    }
    onVerified?.();
  };

  const copySecret = async () => {
    if (!enrollment?.totp?.secret) return;
    await navigator.clipboard.writeText(enrollment.totp.secret);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <form onSubmit={verify} className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-950/40 dark:text-primary-300"><QrCode size={20} /></span>
        <div>
          <h2 className="font-semibold text-gray-950 dark:text-white">Подключите двухфакторную защиту</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Откройте Google Authenticator, Microsoft Authenticator, Aegis или другое TOTP-приложение и отсканируйте QR-код.</p>
        </div>
      </div>
      {busy && !enrollment && <p className="text-sm text-gray-500">Создаём защищённый фактор…</p>}
      {enrollment?.totp && (
        <>
          <div className="mx-auto w-fit rounded-2xl bg-white p-3 shadow-sm">
            <img src={totpQrCodeDataUrl(enrollment.totp.qr_code)} alt="QR-код для подключения TOTP" className="h-52 w-52" />
          </div>
          <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-900/50">
            <p className="text-xs text-gray-500">Если QR-код не сканируется, введите ключ вручную:</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all text-sm text-gray-900 dark:text-gray-100">{enrollment.totp.secret}</code>
              <button type="button" onClick={copySecret} className="btn-secondary min-h-11 min-w-11 p-2" aria-label="Скопировать секретный ключ"><Copy size={16} /></button>
            </div>
            {copied && <p role="status" className="mt-1 text-xs text-green-600">Ключ скопирован</p>}
          </div>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="input-field text-center font-mono text-lg tracking-[0.35em]"
            value={code}
            onChange={(event) => setCode(normalizeTotpCode(event.target.value))}
            placeholder="000000"
            aria-label="Первый код приложения-аутентификатора"
            maxLength={6}
          />
        </>
      )}
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className={`grid gap-2 ${onCancel ? 'sm:grid-cols-2' : ''}`}>
        {onCancel && <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary min-h-11">Отмена</button>}
        <button type="submit" disabled={busy || !enrollment || code.length !== 6} className="btn-primary min-h-11 disabled:opacity-50">{busy && enrollment ? 'Проверяем…' : 'Подключить TOTP'}</button>
      </div>
      <p className="text-xs leading-5 text-gray-500">Секрет показывается только сейчас. Не сохраняйте его в заметках или облаке без шифрования. При потере устройства потребуется восстановление доступа через поддержку.</p>
    </form>
  );
}
