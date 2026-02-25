import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../contexts/AuthContext';

export function useTags(workspaceId) {
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadTags = useCallback(async () => {
    if (!workspaceId) {
      setTags([]);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const { data, error: loadErr } = await supabase
        .from('tags')
        .select('id, workspace_id, name, color')
        .eq('workspace_id', workspaceId)
        .order('name', { ascending: true });

      if (loadErr) throw loadErr;
      setTags(data || []);
    } catch (e) {
      console.error('useTags: load error', e);
      setError(e.message || 'Ошибка загрузки тегов');
      setTags([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const addTag = useCallback(async ({ name, color }) => {
    if (!workspaceId) return null;
    try {
      const trimmed = name.trim();
      // SELECT first to avoid upsert requiring UPDATE policy
      const { data: existing } = await supabase
        .from('tags')
        .select('id, workspace_id, name, color')
        .eq('workspace_id', workspaceId)
        .eq('name', trimmed)
        .maybeSingle();
      if (existing) { await loadTags(); return existing; }

      const { data, error: insertErr } = await supabase
        .from('tags')
        .insert({ workspace_id: workspaceId, name: trimmed, color: color || '#6B7280' })
        .select('id, workspace_id, name, color')
        .single();

      if (insertErr) throw insertErr;
      await loadTags();
      return data;
    } catch (e) {
      console.error('useTags: add error', e);
      setError(e.message || 'Ошибка добавления тега');
      return null;
    }
  }, [workspaceId, loadTags]);

  const findOrCreateTag = useCallback(async (name) => {
    if (!workspaceId || !name?.trim()) return null;
    const trimmed = name.trim();
    // Check local cache first
    const cached = tags.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
    if (cached) return cached;

    // SELECT from DB (another session may have created it)
    const { data: existing } = await supabase
      .from('tags')
      .select('id, name, color')
      .eq('workspace_id', workspaceId)
      .eq('name', trimmed)
      .maybeSingle();
    if (existing) return existing;

    // INSERT new tag
    const { data, error: insertErr } = await supabase
      .from('tags')
      .insert({ workspace_id: workspaceId, name: trimmed, color: '#6B7280' })
      .select('id, name, color')
      .single();

    if (insertErr) {
      console.error('useTags: findOrCreate error', insertErr);
      return null;
    }
    return data;
  }, [workspaceId, tags]);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  return { tags, loading, error, addTag, findOrCreateTag, refresh: loadTags };
}

export default useTags;
