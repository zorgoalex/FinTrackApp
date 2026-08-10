import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import PasswordInput from './PasswordInput';

export default function PasswordStepUpForm({ reason, busy = false, error = '', onVerify, onCancel }) {
  const [password, setPassword] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (!password || busy) return;
    await onVerify(password);
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-950/40 dark:text-primary-300"><KeyRound size={20} /></span>
        <div>
          <h2 className="font-semibold text-gray-950 dark:text-white">Подтвердите текущий пароль</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{reason || 'Это действие требует повторной проверки владельца аккаунта.'}</p>
        </div>
      </div>
      <PasswordInput
        autoFocus
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="Текущий пароль"
        aria-label="Текущий пароль для подтверждения действия"
      />
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary min-h-11">Отмена</button>
        <button type="submit" disabled={busy || !password} className="btn-primary min-h-11 disabled:opacity-50">{busy ? 'Проверяем…' : 'Подтвердить'}</button>
      </div>
    </form>
  );
}
