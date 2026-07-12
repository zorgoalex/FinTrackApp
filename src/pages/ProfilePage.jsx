import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Layers, LogOut, User } from 'lucide-react';
import { supabase, useAuth } from '../contexts/AuthContext';

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
          <div><dt className="text-xs text-gray-500">Имя аккаунта</dt><dd className="mt-0.5 font-medium">{profile?.username || '—'}</dd></div>
          <div><dt className="text-xs text-gray-500">Дата регистрации</dt><dd className="mt-0.5 font-medium">{profile?.created_at ? new Date(profile.created_at).toLocaleDateString('ru-RU') : '—'}</dd></div>
        </dl>
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
