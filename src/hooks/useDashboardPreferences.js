import { useCallback, useEffect, useState } from 'react';
import { supabase, useAuth } from '../contexts/AuthContext';

export const DASHBOARD_WIDGETS = ['summary', 'accounts', 'net_worth', 'debts', 'recent_operations'];

const defaults = () => ({
  widget_order: [...DASHBOARD_WIDGETS],
  hidden_widgets: [],
  widget_sizes: {},
  widget_settings: {},
});

function normalizePreferences(value) {
  const received = Array.isArray(value?.widget_order)
    ? value.widget_order.filter((item) => DASHBOARD_WIDGETS.includes(item))
    : [];
  const order = [...new Set(received)];
  const completed = [...order, ...DASHBOARD_WIDGETS.filter((item) => !order.includes(item))];
  return {
    widget_order: ['summary', ...completed.filter((item) => item !== 'summary')],
    hidden_widgets: Array.isArray(value?.hidden_widgets)
      ? value.hidden_widgets.filter((item) => DASHBOARD_WIDGETS.includes(item))
      : [],
    widget_sizes: value?.widget_sizes && typeof value.widget_sizes === 'object' ? value.widget_sizes : {},
    widget_settings: value?.widget_settings && typeof value.widget_settings === 'object' ? value.widget_settings : {},
  };
}

function readLegacyPreferences(workspaceId) {
  if (typeof window === 'undefined') return defaults();
  let dashboardBlocks = {};
  let visibleAccountIds = null;
  try { dashboardBlocks = JSON.parse(localStorage.getItem(`dashboardBlocks_${workspaceId}`) || '{}'); } catch { dashboardBlocks = {}; }
  try { visibleAccountIds = JSON.parse(localStorage.getItem(`visibleAccounts_${workspaceId}`) || 'null'); } catch { visibleAccountIds = null; }
  return normalizePreferences({
    ...defaults(),
    hidden_widgets: dashboardBlocks.debts === false ? ['debts'] : [],
    widget_settings: {
      accounts: {
        summaryOnly: localStorage.getItem(`accountsSummaryOnly_${workspaceId}`) === 'true',
        visibleAccountIds: Array.isArray(visibleAccountIds) ? visibleAccountIds : null,
      },
    },
  });
}

export default function useDashboardPreferences(workspaceId) {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState(defaults);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!workspaceId || !user?.id) {
      setPreferences(defaults());
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await supabase
      .from('dashboard_preferences')
      .select('widget_order, hidden_widgets, widget_sizes, widget_settings')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (loadError) setError(loadError.message || 'Не удалось загрузить настройки dashboard');
    if (!loadError && !data) {
      const migrated = readLegacyPreferences(workspaceId);
      const { error: migrationError } = await supabase.from('dashboard_preferences').upsert({
        workspace_id: workspaceId, user_id: user.id, ...migrated,
      }, { onConflict: 'workspace_id,user_id' });
      if (!migrationError && typeof window !== 'undefined') {
        localStorage.removeItem(`dashboardBlocks_${workspaceId}`);
        localStorage.removeItem(`visibleAccounts_${workspaceId}`);
        localStorage.removeItem(`accountsSummaryOnly_${workspaceId}`);
      }
      if (migrationError) setError(migrationError.message || 'Не удалось перенести настройки dashboard');
      setPreferences(migrated);
    } else {
      setPreferences(normalizePreferences(data));
    }
    setLoading(false);
  }, [workspaceId, user?.id]);

  const save = useCallback(async (nextValue) => {
    if (!workspaceId || !user?.id) return false;
    const next = normalizePreferences(nextValue);
    const previous = preferences;
    setPreferences(next);
    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase.from('dashboard_preferences').upsert({
      workspace_id: workspaceId,
      user_id: user.id,
      ...next,
    }, { onConflict: 'workspace_id,user_id' });
    setSaving(false);
    if (saveError) {
      setPreferences(previous);
      setError(saveError.message || 'Не удалось сохранить настройки dashboard');
      return false;
    }
    return true;
  }, [workspaceId, user?.id, preferences]);

  const toggleWidget = useCallback((widget) => {
    const hidden = preferences.hidden_widgets.includes(widget)
      ? preferences.hidden_widgets.filter((item) => item !== widget)
      : [...preferences.hidden_widgets, widget];
    return save({ ...preferences, hidden_widgets: hidden });
  }, [preferences, save]);

  const moveWidget = useCallback((widget, direction) => {
    if (widget === 'summary') return;
    const movable = preferences.widget_order.filter((item) => item !== 'summary');
    const index = movable.indexOf(widget);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= movable.length) return;
    [movable[index], movable[nextIndex]] = [movable[nextIndex], movable[index]];
    return save({ ...preferences, widget_order: ['summary', ...movable] });
  }, [preferences, save]);

  const toggleWidgetSize = useCallback((widget) => save({
    ...preferences,
    widget_sizes: {
      ...preferences.widget_sizes,
      [widget]: preferences.widget_sizes[widget] === 'wide' ? 'normal' : 'wide',
    },
  }), [preferences, save]);

  useEffect(() => { load(); }, [load]);

  return { preferences, loading, saving, error, save, toggleWidget, moveWidget, toggleWidgetSize, refresh: load };
}
