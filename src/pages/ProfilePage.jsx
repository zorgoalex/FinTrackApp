import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ExternalLink, KeyRound, Layers, LogOut, MessageCircle, RefreshCw, Trash2, Unlink, User } from 'lucide-react';
import { supabase, useAuth } from '../contexts/AuthContext';
import PasswordInput from '../components/PasswordInput';
import MfaSettings from '../components/MfaSettings';
import TurnstileWidget, { isTurnstileEnabled, TURNSTILE_REQUIRED_MESSAGE } from '../components/TurnstileWidget';
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from '../utils/passwordPolicy';

async function invokeTelegram(action) {
  const result = await supabase.functions.invoke('telegram-link', { body: { action } });
  if (!result.error) return result;
  try {
    const payload = await result.error.context?.json();
    return { ...result, data: payload };
  } catch {
    return result;
  }
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, updatePassword, logout } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [passwordCaptchaToken, setPasswordCaptchaToken] = useState('');
  const passwordTurnstileRef = useRef(null);
  const [telegram, setTelegram] = useState({ loading: true, linked: false });
  const [telegramLink, setTelegramLink] = useState(null);
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [telegramError, setTelegramError] = useState('');
  const [telegramMessage, setTelegramMessage] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deleteEmail, setDeleteEmail] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleteCaptchaToken, setDeleteCaptchaToken] = useState('');
  const deleteTurnstileRef = useRef(null);

  const loadTelegram = useCallback(async ({ silent = false } = {}) => {
    const { data, error: invokeError } = await invokeTelegram('status');
    if (invokeError || data?.error) {
      if (!silent) setTelegramError(data?.error || 'Не удалось проверить Telegram');
      setTelegram((current) => ({ ...current, loading: false }));
      return false;
    }
    setTelegramError('');
    setTelegram({ loading: false, linked: Boolean(data.linked), telegram_username: data.telegram_username, first_name: data.first_name, linked_at: data.linked_at });
    if (data.linked) {
      setTelegramLink(null);
      setTelegramMessage('Telegram успешно подключён');
    }
    return Boolean(data.linked);
  }, []);

  useEffect(() => {
    let active = true;
    const loadProfile = async () => {
      const { data } = await supabase.from('profiles').select('username, display_name, created_at').eq('user_id', user.id).maybeSingle();
      if (active) {
        setProfile(data);
        setLoading(false);
      }
    };
    if (user?.id) loadProfile();
    return () => { active = false; };
  }, [user?.id]);

  useEffect(() => { loadTelegram(); }, [loadTelegram]);

  useEffect(() => {
    if (!telegramLink || telegram.linked) return undefined;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const polling = window.setInterval(() => loadTelegram({ silent: true }), 3000);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(polling);
    };
  }, [loadTelegram, telegram.linked, telegramLink]);

  const connectTelegram = async () => {
    setTelegramBusy(true);
    setTelegramError('');
    setTelegramMessage('');
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    const { data, error: invokeError } = await invokeTelegram('create');
    setTelegramBusy(false);
    if (invokeError || data?.error || !data?.url) {
      if (popup) popup.close();
      setTelegramError(data?.error || 'Не удалось создать ссылку Telegram');
      return;
    }
    setTelegramLink({ url: data.url, expires_at: data.expires_at, bot_username: data.bot_username });
    setNow(Date.now());
    if (popup) popup.location.href = data.url;
  };

  const checkTelegram = async () => {
    setTelegramBusy(true);
    setTelegramError('');
    setTelegramMessage('Проверяем подключение…');
    const linked = await loadTelegram();
    setTelegramBusy(false);
    if (!linked) setTelegramMessage('Telegram пока не подключён. В боте нажмите Start, затем проверьте ещё раз.');
  };

  const unlinkTelegram = async () => {
    setTelegramBusy(true);
    setTelegramError('');
    setTelegramMessage('');
    const { data, error: invokeError } = await invokeTelegram('unlink');
    setTelegramBusy(false);
    if (invokeError || data?.error) { setTelegramError(data?.error || 'Не удалось отключить Telegram'); return; }
    setTelegram({ loading: false, linked: false });
    setTelegramLink(null);
  };

  const changePassword = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!isStrongPassword(password)) { setError(PASSWORD_POLICY_MESSAGE); return; }
    if (password !== confirmation) { setError('Пароли не совпадают'); return; }
    if (!currentPassword) { setError('Введите текущий пароль'); return; }
    if (isTurnstileEnabled && !passwordCaptchaToken) { setError(TURNSTILE_REQUIRED_MESSAGE); return; }
    setSaving(true);
    const result = await updatePassword(password, currentPassword, passwordCaptchaToken);
    setPasswordCaptchaToken('');
    passwordTurnstileRef.current?.reset();
    setSaving(false);
    if (!result.success) { setError(result.error || 'Не удалось изменить пароль'); return; }
    setPassword('');
    setConfirmation('');
    setCurrentPassword('');
    setMessage('Пароль успешно изменён');
  };

  const signOut = async () => {
    await logout().catch(() => undefined);
    navigate('/login', { replace: true });
  };

  const deleteAccount = async () => {
    setDeleteError('');
    if (deleteEmail.trim().toLowerCase() !== user?.email?.toLowerCase()) {
      setDeleteError('Введите email текущего аккаунта полностью');
      return;
    }
    if (!deletePassword) {
      setDeleteError('Введите текущий пароль');
      return;
    }
    if (isTurnstileEnabled && !deleteCaptchaToken) {
      setDeleteError(TURNSTILE_REQUIRED_MESSAGE);
      return;
    }
    setDeleteBusy(true);
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: deletePassword,
      options: { captchaToken: deleteCaptchaToken },
    });
    setDeleteCaptchaToken('');
    deleteTurnstileRef.current?.reset();
    if (reauthError) {
      setDeleteBusy(false);
      setDeleteError(/captcha|turnstile|challenge/i.test(String(reauthError.message || ''))
        ? 'Не удалось пройти проверку безопасности. Обновите проверку и попробуйте ещё раз.'
        : 'Текущий пароль неверен');
      return;
    }
    const { error: deletionError } = await supabase.rpc('delete_my_account', {
      p_confirmation_email: deleteEmail.trim(),
    });
    setDeleteBusy(false);
    if (deletionError) {
      setDeleteError(deletionError.message || 'Не удалось удалить аккаунт');
      return;
    }
    await logout().catch(() => undefined);
    navigate('/login', { replace: true });
  };

  const displayName = profile?.display_name || profile?.username || user?.email || 'Пользователь';
  const initial = displayName.charAt(0).toUpperCase();
  const telegramExpiresAt = telegramLink ? new Date(telegramLink.expires_at).getTime() : 0;
  const telegramSecondsLeft = Math.max(0, Math.ceil((telegramExpiresAt - now) / 1000));
  const telegramLinkExpired = Boolean(telegramLink && telegramSecondsLeft === 0);
  const telegramTimeLeft = `${String(Math.floor(telegramSecondsLeft / 60)).padStart(2, '0')}:${String(telegramSecondsLeft % 60).padStart(2, '0')}`;

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-24 sm:p-6" data-testid="profile-page">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-primary-600">Аккаунт</p>
        <h1 className="text-2xl font-bold text-gray-950 dark:text-white">Личный кабинет</h1>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-4">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 text-xl font-bold text-white shadow-sm">{initial}</div>
          <div className="min-w-0">
            <h2 className="truncate font-semibold text-gray-900 dark:text-gray-100">{loading ? 'Загрузка…' : displayName}</h2>
            {profile?.username && <p className="text-sm text-gray-500">@{profile.username}</p>}
            <p className="truncate text-sm text-gray-500">{user?.email}</p>
          </div>
        </div>
        <dl className="mt-4 grid gap-3 border-t border-gray-100 pt-4 text-sm dark:border-gray-700 sm:grid-cols-2">
          <div><dt className="text-xs text-gray-500">Логин</dt><dd className="mt-0.5 font-medium">{profile?.username || '—'}</dd></div>
          <div><dt className="text-xs text-gray-500">Дата регистрации</dt><dd className="mt-0.5 font-medium">{profile?.created_at ? new Date(profile.created_at).toLocaleDateString('ru-RU') : '—'}</dd></div>
        </dl>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-300"><MessageCircle size={21} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">Telegram</h2>
            {telegram.loading ? <p className="text-sm text-gray-500">Проверяем подключение…</p> : telegram.linked ? (
              <p className="text-sm text-green-600">Подключён{telegram.telegram_username ? ` · @${telegram.telegram_username}` : telegram.first_name ? ` · ${telegram.first_name}` : ''}</p>
            ) : <p className="text-sm text-gray-500">Не подключён</p>}
          </div>
        </div>
        {telegramError && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-600 dark:bg-red-950/30">{telegramError}</p>}
        {telegramMessage && !telegramError && <p role="status" className="mt-3 rounded-lg bg-gray-50 p-2 text-sm text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">{telegramMessage}</p>}
        {telegramLink && !telegram.linked && (
          <div className={`mt-3 rounded-xl p-3 text-sm ${telegramLinkExpired ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200' : 'bg-sky-50 text-sky-900 dark:bg-sky-950/30 dark:text-sky-200'}`}>
            {telegramLinkExpired ? (
              <>
                <p className="font-medium">Срок ссылки истёк</p>
                <p className="mt-0.5 text-xs opacity-75">Создайте новую ссылку — старая больше не подключит аккаунт.</p>
                <button type="button" disabled={telegramBusy} onClick={connectTelegram} className="btn-primary mt-3 min-h-11 w-full">{telegramBusy ? 'Создаём ссылку…' : 'Создать новую ссылку'}</button>
              </>
            ) : (
              <>
                <p className="font-medium">Откройте @{telegramLink.bot_username} и обязательно нажмите Start</p>
                <p className="mt-0.5 text-xs opacity-75">Ссылка действует ещё {telegramTimeLeft}</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <a href={telegramLink.url} target="_blank" rel="noreferrer" className="btn-primary flex min-h-11 items-center justify-center gap-1.5 text-sm"><ExternalLink size={16} /> Открыть бота</a>
                  <button type="button" disabled={telegramBusy} onClick={checkTelegram} className="btn-secondary flex min-h-11 items-center justify-center gap-1.5 text-sm"><RefreshCw size={16} /> Проверить подключение</button>
                </div>
              </>
            )}
          </div>
        )}
        <div className="mt-3">
          {telegram.linked ? (
            <button type="button" disabled={telegramBusy} onClick={unlinkTelegram} className="btn-secondary flex min-h-11 w-full items-center justify-center gap-2 text-sm text-red-600"><Unlink size={16} /> Отключить Telegram</button>
          ) : !telegramLink && (
            <button type="button" disabled={telegramBusy || telegram.loading} onClick={connectTelegram} className="btn-primary min-h-11 w-full">{telegramBusy ? 'Создаём ссылку…' : 'Подключить Telegram'}</button>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <MfaSettings />
      </section>

      <button type="button" onClick={() => navigate('/workspaces')} className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 text-left hover:border-primary-300 dark:border-gray-700 dark:bg-gray-800">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-950/40 dark:text-primary-300"><Layers size={20} /></span>
        <span><span className="block text-sm font-semibold">Мои пространства</span><span className="block text-xs text-gray-500">Выбор и создание пространств</span></span>
      </button>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 flex items-center gap-2"><KeyRound size={19} className="text-primary-600" /><h2 className="font-semibold">Сменить пароль</h2></div>
        <form onSubmit={changePassword} className="space-y-3">
          <PasswordInput autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="Текущий пароль" aria-label="Текущий пароль" />
          <PasswordInput autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Новый пароль — не менее 8 символов" aria-label="Новый пароль" minLength={8} />
          <PasswordInput autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Повторите пароль" aria-label="Повторите пароль" />
          <TurnstileWidget
            ref={passwordTurnstileRef}
            action="change_password"
            onTokenChange={setPasswordCaptchaToken}
            onError={setError}
          />
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          {message && <p role="status" className="text-sm text-green-600">{message}</p>}
          <button type="submit" disabled={saving || !password || !confirmation} className="btn-primary min-h-11 w-full disabled:opacity-50">{saving ? 'Сохраняем…' : 'Обновить пароль'}</button>
        </form>
      </section>

      <button type="button" onClick={signOut} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-3 text-sm font-semibold text-red-600 hover:bg-red-50 dark:border-red-900 dark:bg-gray-800 dark:hover:bg-red-950/30"><LogOut size={18} /> Выйти из аккаунта</button>

      <section className="rounded-2xl border border-red-200 bg-white p-4 dark:border-red-900 dark:bg-gray-800">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950/40"><Trash2 size={20} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-red-700 dark:text-red-300">Удаление аккаунта</h2>
            <p className="mt-1 text-xs leading-5 text-gray-500">Действие необратимо. Ваши пространства и их данные будут удалены для всех участников; записи, созданные вами в чужих пространствах, останутся у владельца пространства.</p>
          </div>
        </div>
        {!showDeleteAccount ? (
          <button type="button" onClick={() => setShowDeleteAccount(true)} className="mt-3 min-h-11 w-full rounded-xl border border-red-300 px-4 text-sm font-semibold text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/30">Начать удаление</button>
        ) : (
          <div className="mt-4 space-y-3 rounded-xl bg-red-50 p-3 dark:bg-red-950/30">
            <p className="flex items-start gap-2 text-xs leading-5 text-red-800 dark:text-red-200"><AlertTriangle size={16} className="mt-0.5 shrink-0" />Сначала сохраните JSON-backup нужных пространств. Для подтверждения введите email <strong>{user?.email}</strong>.</p>
            <input type="email" className="input-field" value={deleteEmail} onChange={(event) => setDeleteEmail(event.target.value)} placeholder="Email текущего аккаунта" aria-label="Email для подтверждения удаления аккаунта" autoComplete="email" />
            <PasswordInput autoComplete="current-password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} placeholder="Текущий пароль" aria-label="Текущий пароль для удаления аккаунта" />
            <TurnstileWidget
              ref={deleteTurnstileRef}
              action="delete_account"
              onTokenChange={setDeleteCaptchaToken}
              onError={setDeleteError}
            />
            {deleteError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{deleteError}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" disabled={deleteBusy} onClick={() => { setShowDeleteAccount(false); setDeleteEmail(''); setDeletePassword(''); setDeleteError(''); setDeleteCaptchaToken(''); deleteTurnstileRef.current?.reset(); }} className="btn-secondary min-h-11">Отмена</button>
              <button type="button" disabled={deleteBusy || !deletePassword || deleteEmail.trim().toLowerCase() !== user?.email?.toLowerCase()} onClick={deleteAccount} className="min-h-11 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{deleteBusy ? 'Удаляем…' : 'Удалить навсегда'}</button>
            </div>
          </div>
        )}
      </section>
      <p className="text-center text-xs text-gray-500"><Link to="/legal" className="underline hover:text-primary-600">Условия, конфиденциальность и удаление данных</Link></p>
      <p className="flex items-center justify-center gap-1.5 text-xs text-gray-400"><User size={13} /> Настройки относятся ко всему аккаунту</p>
    </div>
  );
}
