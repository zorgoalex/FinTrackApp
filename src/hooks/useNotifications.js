import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, useAuth } from '../contexts/AuthContext';

const defaultPreferences = () => ({
  channels: ['in_app', 'telegram'],
  event_types: ['cashflow_plan', 'scheduled_operation', 'debt_due'],
  reminder_days: [1, 0],
  delivery_mode: 'individual',
  delivery_hour: 9,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
});

export function useNotifications(workspaceId) {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [loading, setLoading] = useState(false);
  const initialized = useRef(false);
  const knownIds = useRef(new Set());

  const load = useCallback(async () => {
    if (!workspaceId || !user) return;
    const [notificationsResult, preferencesResult, telegramResult] = await Promise.all([
      supabase.from('app_notifications').select('*').eq('workspace_id', workspaceId).eq('in_app_visible', true).order('created_at', { ascending: false }).limit(30),
      supabase.from('notification_preferences').select('*').eq('workspace_id', workspaceId).eq('user_id', user.id).maybeSingle(),
      supabase.rpc('is_telegram_linked'),
    ]);
    const nextItems = notificationsResult.data || [];
    const nextPreferences = preferencesResult.data || defaultPreferences();
    if (!preferencesResult.data && !preferencesResult.error) {
      await supabase.from('notification_preferences').upsert({ ...nextPreferences, workspace_id: workspaceId, user_id: user.id }, { onConflict: 'workspace_id,user_id' });
    }
    if (initialized.current && nextPreferences.channels?.includes('browser') && typeof window.Notification !== 'undefined' && window.Notification.permission === 'granted') {
      nextItems.filter((item) => !item.read_at && !knownIds.current.has(item.id)).forEach((item) => {
        new window.Notification(item.title, { body: item.body, tag: item.id });
      });
    }
    knownIds.current = new Set(nextItems.map((item) => item.id));
    initialized.current = true;
    setItems(nextItems);
    setPreferences(nextPreferences);
    setTelegramLinked(Boolean(telegramResult.data));
  }, [user, workspaceId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
    const interval = window.setInterval(load, 60000);
    return () => window.clearInterval(interval);
  }, [load]);

  const savePreferences = useCallback(async (next) => {
    if (!workspaceId || !user) return { error: 'Нет активного пространства' };
    const payload = { ...next, workspace_id: workspaceId, user_id: user.id };
    const { error } = await supabase.from('notification_preferences').upsert(payload, { onConflict: 'workspace_id,user_id' });
    if (!error) setPreferences(next);
    return { error: error?.message || null };
  }, [user, workspaceId]);

  const markAllRead = useCallback(async () => {
    if (!workspaceId || !user) return;
    const timestamp = new Date().toISOString();
    const { error } = await supabase.from('app_notifications').update({ read_at: timestamp }).eq('workspace_id', workspaceId).eq('user_id', user.id).is('read_at', null);
    if (!error) setItems((current) => current.map((item) => item.read_at ? item : { ...item, read_at: timestamp }));
  }, [user, workspaceId]);

  const enableBrowser = useCallback(async () => {
    if (typeof window.Notification === 'undefined') return { error: 'Этот браузер не поддерживает уведомления' };
    const permission = await window.Notification.requestPermission();
    if (permission !== 'granted') return { error: 'Браузер не разрешил уведомления' };
    return savePreferences({ ...preferences, channels: [...new Set([...(preferences.channels || []), 'browser'])] });
  }, [preferences, savePreferences]);

  return { items, unreadCount: items.filter((item) => !item.read_at).length, preferences, telegramLinked, loading, load, savePreferences, markAllRead, enableBrowser };
}

export default useNotifications;
