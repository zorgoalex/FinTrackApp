import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, KeyRound, Layers, LogOut, MessageCircle, RefreshCw, Unlink, User } from 'lucide-react';
import { supabase, useAuth } from '../contexts/AuthContext';

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
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [telegram, setTelegram] = useState({ loading: true, linked: false });
  const [telegramLink, setTelegramLink] = useState(null);
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [telegramError, setTelegramError] = useState('');

  const loadTelegram = useCallback(async () => {
    const { data, error: invokeError } = await invokeTelegram('status');
    if (invokeError || data?.error) {
      setTelegramError(data?.error || 'Не удалось проверить Telegram');
      setTelegram((current) => ({ ...current, loading: false }));
      return false;
    }
    setTelegram({ loading: false, linked: Boolean(data.linked), telegram_username: data.telegram_username, first_name: data.first_name, linked_at: data.linked_at });
    if (data.linked) setTelegramLink(null);
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
    const interval = window.setInterval(loadTelegram, 3000);
    return () => window.clearInterval(interval);
  }, [loadTelegram, telegram.linked, telegramLink]);

  const connectTelegram = async () => {
    setTelegramBusy(true);
    setTelegramError('');
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
    if (popup) popup.location.href = data.url;
  };

  const unlinkTelegram = async () => {
    setTelegramBusy(true);
    setTelegramError('');
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
    if (password.length < 6) { setError('Пароль должен содержать не менее 6 символов'); return; }
    if (password !== confirmation) { setError('Пароли не совпадают'); return; }
    setSaving(true);
    const success = await updatePassword(password);
    setSaving(false);
    if (!success) { setError('Не удалось изменить пароль'); return; }
    setPassword('');
    setConfirmation('');
    setMessage('Пароль успешно изменён');
  };

  const signOut = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const displayName = profile?.display_name || profile?.username || user?.email || 'Пользователь';
  const initial = displayName.charAt(0).toUpperCase();

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
        {telegramLink && !telegram.linked && (
          <div className="mt-3 rounded-xl bg-sky-50 p-3 text-sm text-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
            <p className="font-medium">Откройте @{telegramLink.bot_username} и нажмите Start</p>
            <p className="mt-0.5 text-xs opacity-75">Ссылка действует до {new Date(telegramLink.expires_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</p>
            <div className="mt-3 flex gap-2">
              <a href={telegramLink.url} target="_blank" rel="noreferrer" className="btn-primary flex min-h-11 flex-1 items-center justify-center gap-1.5 text-sm"><ExternalLink size={16} /> Открыть бота</a>
              <button type="button" onClick={loadTelegram} className="btn-secondary grid min-h-11 min-w-11 place-items-center" aria-label="Проверить Telegram"><RefreshCw size={16} /></button>
            </div>
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

      <button type="button" onClick={() => navigate('/workspaces')} className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 text-left hover:border-primary-300 dark:border-gray-700 dark:bg-gray-800">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-950/40 dark:text-primary-300"><Layers size={20} /></span>
        <span><span className="block text-sm font-semibold">Мои пространства</span><span className="block text-xs text-gray-500">Выбор и создание пространств</span></span>
      </button>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 flex items-center gap-2"><KeyRound size={19} className="text-primary-600" /><h2 className="font-semibold">Сменить пароль</h2></div>
        <form onSubmit={changePassword} className="space-y-3">
          <input type="password" autoComplete="new-password" className="input-field" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Новый пароль" aria-label="Новый пароль" />
          <input type="password" autoComplete="new-password" className="input-field" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Повторите пароль" aria-label="Повторите пароль" />
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          {message && <p role="status" className="text-sm text-green-600">{message}</p>}
          <button type="submit" disabled={saving || !password || !confirmation} className="btn-primary min-h-11 w-full disabled:opacity-50">{saving ? 'Сохраняем…' : 'Обновить пароль'}</button>
        </form>
      </section>

      <button type="button" onClick={signOut} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-3 text-sm font-semibold text-red-600 hover:bg-red-50 dark:border-red-900 dark:bg-gray-800 dark:hover:bg-red-950/30"><LogOut size={18} /> Выйти из аккаунта</button>
      <p className="flex items-center justify-center gap-1.5 text-xs text-gray-400"><User size={13} /> Настройки относятся ко всему аккаунту</p>
    </div>
  );
}
