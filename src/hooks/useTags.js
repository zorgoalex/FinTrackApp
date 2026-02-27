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
        .select('id, workspace_id, name, color, is_archived')
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
        .select('id, workspace_id, name, color, is_archived')
        .eq('workspace_id', workspaceId)
        .eq('name', trimmed)
        .maybeSingle();
      if (existing) { await loadTags(); return existing; }

      const { data, error: insertErr } = await supabase
        .from('tags')
        .insert({ workspace_id: workspaceId, name: trimmed, color: color || '#6B7280' })
        .select('id, workspace_id, name, color, is_archived')
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

  const updateTag = useCallback(async (id, { name, color }) => {
    if (!workspaceId) return null;
    try {
      const updates = {};
      if (name !== undefined) updates.name = name.trim();
      if (color !== undefined) updates.color = color;

      const { data, error: updateErr } = await supabase
        .from('tags')
        .update(updates)
        .eq('id', id)
        .eq('workspace_id', workspaceId)
        .select('id, workspace_id, name, color, is_archived')
        .single();

      if (updateErr) throw updateErr;
      await loadTags();
      return data;
    } catch (e) {
      console.error('useTags: update error', e);
      setError(e.message || 'Ошибка обновления тега');
      return null;
    }
  }, [workspaceId, loadTags]);

  const deleteTag = useCallback(async (id) => {
    if (!workspaceId) return { error: 'Нет рабочего пространства' };
    try {
      const { count } = await supabase
        .from('operation_tags')
        .select('operation_id', { count: 'exact', head: true })
        .eq('tag_id', id);

      if (count > 0) {
        return { error: `Нельзя удалить: тег используется в ${count} операции(ях)` };
      }

      const { error: deleteErr } = await supabase
        .from('tags')
        .delete()
        .eq('id', id)
        .eq('workspace_id', workspaceId);

      if (deleteErr) throw deleteErr;
      await loadTags();
      return { success: true };
    } catch (e) {
      console.error('useTags: delete error', e);
      const msg = e.message || 'Ошибка удаления тега';
      setError(msg);
      return { error: msg };
    }
  }, [workspaceId, loadTags]);

  const archiveTag = useCallback(async (id) => {
    if (!workspaceId) return { error: 'Нет рабочего пространства' };
    try {
      const { error: updateErr } = await supabase
        .from('tags')
        .update({ is_archived: true })
        .eq('id', id)
        .eq('workspace_id', workspaceId);

      if (updateErr) throw updateErr;
      await loadTags();
      return { success: true };
    } catch (e) {
      console.error('useTags: archive error', e);
      const msg = e.message || 'Ошибка архивации тега';
      setError(msg);
      return { error: msg };
    }
  }, [workspaceId, loadTags]);

  const unarchiveTag = useCallback(async (id) => {
    if (!workspaceId) return { error: 'Нет рабочего пространства' };
    try {
      const { error: updateErr } = await supabase
        .from('tags')
        .update({ is_archived: false })
        .eq('id', id)
        .eq('workspace_id', workspaceId);

      if (updateErr) throw updateErr;
      await loadTags();
      return { success: true };
    } catch (e) {
      console.error('useTags: unarchive error', e);
      const msg = e.message || 'Ошибка разархивации тега';
      setError(msg);
      return { error: msg };
    }
  }, [workspaceId, loadTags]);

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  return { tags, loading, error, addTag, updateTag, deleteTag, archiveTag, unarchiveTag, findOrCreateTag, refresh: loadTags };
}

export default useTags;
