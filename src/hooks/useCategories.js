import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../contexts/AuthContext';

export function useCategories(workspaceId) {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadCategories = useCallback(async () => {
    if (!workspaceId) {
      setCategories([]);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const { data, error: loadErr } = await supabase
        .from('categories')
        .select('id, workspace_id, name, type, color')
        .eq('workspace_id', workspaceId)
        .order('name', { ascending: true });

      if (loadErr) throw loadErr;
      setCategories(data || []);
    } catch (e) {
      console.error('useCategories: load error', e);
      setError(e.message || 'Ошибка загрузки категорий');
      setCategories([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const addCategory = useCallback(async ({ name, type, color }) => {
    if (!workspaceId) return null;
    try {
      const { data, error: insertErr } = await supabase
        .from('categories')
        .insert([{ workspace_id: workspaceId, name: name.trim(), type, color: color || '#6B7280' }])
        .select('id, workspace_id, name, type, color')
        .single();

      if (insertErr) throw insertErr;
      await loadCategories();
      return data;
    } catch (e) {
      console.error('useCategories: add error', e);
      setError(e.message || 'Ошибка добавления категории');
      return null;
    }
  }, [workspaceId, loadCategories]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  return { categories, loading, error, addCategory, refresh: loadCategories };
}

export default useCategories;
