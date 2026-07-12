import { useEffect, useState } from 'react';
import { Bell, CheckCheck, Clock3, Settings2, X } from 'lucide-react';

const REMINDER_OPTIONS = [
  { value: 0, label: 'В день события' },
  { value: 1, label: 'За 1 день' },
  { value: 3, label: 'За 3 дня' },
  { value: 7, label: 'За 7 дней' },
];
const EVENT_OPTIONS = [
  { value: 'cashflow_plan', label: 'Плановые платежи и поступления' },
  { value: 'scheduled_operation', label: 'Регулярные операции' },
  { value: 'debt_due', label: 'Сроки долгов и задолженностей' },
];
const CHANNEL_OPTIONS = [
  { value: 'in_app', label: 'В приложении' },
  { value: 'telegram', label: 'Telegram-бот' },
  { value: 'browser', label: 'Уведомления браузера' },
  { value: 'email', label: 'E-mail', disabled: true, hint: 'Подключение позже' },
  { value: 'whatsapp', label: 'WhatsApp', disabled: true, hint: 'Подключение позже' },
];

export default function NotificationCenter({ notifications }) {
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState(notifications.preferences);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => setDraft(notifications.preferences), [notifications.preferences]);

  const toggleReminderDay = (day) => {
    const values = draft.reminder_days || [];
    const next = values.includes(day) ? values.filter((value) => value !== day) : [...values, day].sort((a, b) => b - a);
    if (next.length) setDraft({ ...draft, reminder_days: next });
  };
  const toggleListValue = (field, value) => {
    const values = draft[field] || [];
    const next = values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
    if (next.length) setDraft({ ...draft, [field]: next });
  };

  const save = async () => {
    setSaving(true);
    setError('');
    const result = await notifications.savePreferences(draft);
    setSaving(false);
    if (result.error) setError(result.error); else setSettingsOpen(false);
  };

  const enableBrowser = async () => {
    setError('');
    const result = await notifications.enableBrowser();
    if (result.error) setError(result.error); else setDraft((current) => ({ ...current, channels: [...new Set([...(current.channels || []), 'browser'])] }));
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative grid min-h-11 min-w-11 place-items-center rounded-xl text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        aria-label={`Уведомления${notifications.unreadCount ? `, непрочитанных: ${notifications.unreadCount}` : ''}`}
      >
        <Bell size={20} />
        {notifications.unreadCount > 0 && <span className="absolute right-1 top-1 min-w-4 rounded-full bg-red-500 px-1 text-center text-[10px] font-bold leading-4 text-white">{Math.min(notifications.unreadCount, 99)}</span>}
      </button>

      {open && (
        <div className="fixed inset-x-3 top-16 z-50 max-h-[calc(100vh-5rem)] overflow-y-auto rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900 sm:left-auto sm:right-4 sm:w-[390px]">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-900">
            <div><h2 className="font-semibold">Уведомления</h2><p className="text-xs text-gray-500">Платежи и поступления</p></div>
            <div className="flex items-center">
              <button type="button" onClick={notifications.markAllRead} className="grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Отметить все прочитанными"><CheckCheck size={18} /></button>
              <button type="button" onClick={() => setSettingsOpen((value) => !value)} className="grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Настройки уведомлений"><Settings2 size={18} /></button>
              <button type="button" onClick={() => setOpen(false)} className="grid min-h-11 min-w-11 place-items-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Закрыть уведомления"><X size={18} /></button>
            </div>
          </div>

          {settingsOpen && (
            <div className="space-y-4 border-b border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/60">
              <SettingsSpoiler
                label="Каналы"
                summary={CHANNEL_OPTIONS.filter((option) => draft.channels?.includes(option.value)).map((option) => option.label).join(', ')}
              >
                {CHANNEL_OPTIONS.map((option) => {
                  const telegramUnavailable = option.value === 'telegram' && !notifications.telegramLinked;
                  return <Toggle key={option.value} label={option.label} hint={telegramUnavailable ? 'Сначала привяжите аккаунт в боте' : option.value === 'browser' ? 'Пока приложение открыто' : option.hint} checked={draft.channels?.includes(option.value)} disabled={option.disabled || telegramUnavailable} onChange={(checked) => option.value === 'browser' && checked ? enableBrowser() : toggleListValue('channels', option.value)} />;
                })}
              </SettingsSpoiler>

              <SettingsSpoiler
                label="События"
                summary={`${(draft.event_types || []).length} из ${EVENT_OPTIONS.length}`}
              >
                {EVENT_OPTIONS.map((option) => <Toggle key={option.value} label={option.label} checked={draft.event_types?.includes(option.value)} onChange={() => toggleListValue('event_types', option.value)} />)}
              </SettingsSpoiler>

              <SettingsSpoiler label="Когда напоминать" summary={REMINDER_OPTIONS.filter((option) => (draft.reminder_days || []).includes(option.value)).map((option) => option.label).join(', ')}>
                {REMINDER_OPTIONS.map((option) => <Toggle key={option.value} label={option.label} compact checked={(draft.reminder_days || []).includes(option.value)} onChange={() => toggleReminderDay(option.value)} />)}
              </SettingsSpoiler>

              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm"><span className="mb-1 block font-medium">Формат</span><select className="input-field" value={draft.delivery_mode} onChange={(event) => setDraft({ ...draft, delivery_mode: event.target.value })}><option value="individual">Каждое отдельно</option><option value="digest">Дневная сводка</option></select></label>
                <label className="text-sm"><span className="mb-1 block font-medium">Час доставки</span><select className="input-field" value={draft.delivery_hour} onChange={(event) => setDraft({ ...draft, delivery_hour: Number(event.target.value) })}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}</select></label>
              </div>
              <p className="flex items-center gap-1.5 text-xs text-gray-500"><Clock3 size={13} /> Часовой пояс: {draft.timezone}</p>
              {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
              <button type="button" disabled={saving} onClick={save} className="btn-primary min-h-11 w-full">{saving ? 'Сохраняем…' : 'Сохранить настройки'}</button>
            </div>
          )}

          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {notifications.loading ? <p className="p-6 text-center text-sm text-gray-500">Загрузка…</p> : notifications.items.length === 0 ? <div className="p-8 text-center text-gray-500"><Bell className="mx-auto mb-2 opacity-30" size={32} /><p className="text-sm">Новых напоминаний пока нет</p></div> : notifications.items.map((item) => (
              <article key={item.id} className={`p-4 ${item.read_at ? 'opacity-60' : 'bg-primary-50/50 dark:bg-primary-950/20'}`}>
                <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">{item.title}</p><p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{item.body}</p></div>{!item.read_at && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary-500" />}</div>
                <p className="mt-2 text-xs text-gray-400">{new Date(item.created_at).toLocaleString('ru-RU')}</p>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({ label, hint, checked, disabled, onChange, compact }) {
  return (
    <label className={`flex min-h-11 items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900 ${disabled ? 'opacity-50' : ''}`}>
      <span className={compact ? 'text-xs' : 'text-sm'}>{label}{hint && <span className="block text-[11px] text-gray-400">{hint}</span>}</span>
      <input type="checkbox" checked={Boolean(checked)} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="h-5 w-5 accent-primary-600" />
    </label>
  );
}

function SettingsSpoiler({ label, summary, children }) {
  return (
    <details className="group rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 marker:content-none">
        <span className="min-w-0"><span className="block text-sm font-semibold">{label}</span><span className="block truncate text-xs text-gray-500">{summary}</span></span>
        <span className="shrink-0 text-gray-400 transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="space-y-1 border-t border-gray-100 p-2 dark:border-gray-800">{children}</div>
    </details>
  );
}
