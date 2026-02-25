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
      console.log('[DEBUG] useTags loaded:', data?.length, 'tags for workspace:', workspaceId,
        (data || []).slice(0, 5).map((t) => t.name));
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
      const { data, error: upsertErr } = await supabase
        .from('tags')
        .upsert(
          { workspace_id: workspaceId, name: name.trim(), color: color || '#6B7280' },
          { onConflict: 'workspace_id,name' }
        )
        .select('id, workspace_id, name, color')
        .single();

      if (upsertErr) throw upsertErr;
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
    const existing = tags.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing;

    const { data, error: upsertErr } = await supabase
      .from('tags')
      .upsert(
        { workspace_id: workspaceId, name: trimmed },
        { onConflict: 'workspace_id,name' }
      )
      .select('id, name, color')
      .single();

    if (upsertErr) {
      console.error('useTags: findOrCreate error', upsertErr);
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
