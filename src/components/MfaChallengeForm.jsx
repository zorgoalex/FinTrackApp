import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { normalizeTotpCode } from '../utils/mfa';

export default function MfaChallengeForm({ title = 'Подтвердите вход', description, busy = false, error = '', onVerify, onCancel }) {
  const [code, setCode] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (code.length !== 6 || busy) return;
    await onVerify(code);
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-950/40 dark:text-primary-300"><KeyRound size={20} /></span>
        <div>
          <h2 className="font-semibold text-gray-950 dark:text-white">{title}</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description || 'Введите одноразовый код из приложения-аутентификатора.'}</p>
        </div>
      </div>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        className="input-field text-center font-mono text-lg tracking-[0.35em]"
        value={code}
        onChange={(event) => setCode(normalizeTotpCode(event.target.value))}
        placeholder="000000"
        aria-label="Код приложения-аутентификатора"
        maxLength={6}
        autoFocus
      />
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className={`grid gap-2 ${onCancel ? 'sm:grid-cols-2' : ''}`}>
        {onCancel && <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary min-h-11">Отмена</button>}
        <button type="submit" disabled={busy || code.length !== 6} className="btn-primary min-h-11 disabled:opacity-50">{busy ? 'Проверяем…' : 'Подтвердить код'}</button>
      </div>
    </form>
  );
}
