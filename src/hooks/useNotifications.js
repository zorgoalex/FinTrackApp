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
    if (typeof window.Notification === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      return { error: 'Этот браузер не поддерживает Web Push' };
    }
    const publicKey = import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY?.trim();
    if (!publicKey) return { error: 'Web Push ещё не настроен на сервере' };
    const permission = await window.Notification.requestPermission();
    if (permission !== 'granted') return { error: 'Браузер не разрешил уведомления' };
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const serialized = subscription.toJSON();
      const { error: subscriptionError } = await supabase.rpc('upsert_push_subscription', {
        p_workspace_id: workspaceId,
        p_endpoint: subscription.endpoint,
        p_p256dh: serialized.keys?.p256dh || '',
        p_auth: serialized.keys?.auth || '',
        p_user_agent: navigator.userAgent,
      });
      if (subscriptionError) throw subscriptionError;
      return savePreferences({ ...preferences, channels: [...new Set([...(preferences.channels || []), 'browser'])] });
    } catch (pushError) {
      return { error: pushError.message || 'Не удалось создать Web Push подписку' };
    }
  }, [preferences, savePreferences, workspaceId]);

  const disableBrowser = useCallback(async () => {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await supabase.rpc('delete_push_subscription', {
          p_workspace_id: workspaceId,
          p_endpoint: subscription.endpoint,
        });
        const { count } = await supabase.from('push_subscriptions')
          .select('id', { count: 'exact', head: true })
          .eq('endpoint', subscription.endpoint);
        if (!count) await subscription.unsubscribe();
      }
      return savePreferences({
        ...preferences,
        channels: (preferences.channels || []).filter((channel) => channel !== 'browser'),
      });
    } catch (pushError) {
      return { error: pushError.message || 'Не удалось отключить Web Push' };
    }
  }, [preferences, savePreferences, workspaceId]);

  return { items, unreadCount: items.filter((item) => !item.read_at).length, preferences, telegramLinked, loading, load, savePreferences, markAllRead, enableBrowser, disableBrowser };
}

function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replaceAll('-', '+').replaceAll('_', '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

export default useNotifications;
