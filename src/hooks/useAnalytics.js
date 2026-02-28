import { useCallback, useEffect, useState, useMemo } from 'react';
import { supabase } from '../contexts/AuthContext';
import { computeAnalytics } from '../utils/analytics/aggregations';

export default function useAnalytics(workspaceIds, { dateFrom, dateTo } = {}) {
  const [operations, setOperations] = useState([]);
  const [categories, setCategories] = useState([]);
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const ids = [...new Set(Array.isArray(workspaceIds) ? workspaceIds : [workspaceIds])].filter(Boolean);
  const idsKey = ids.slice().sort().join(',');

  const load = useCallback(async () => {
    if (ids.length === 0 || !dateFrom || !dateTo) return;
    try {
      setLoading(true);
      setError(null);

      // Load operations with tags
      let query = supabase
        .from('operations')
        .select('id, type, amount, description, operation_date, category_id, user_id, created_at, tags:operation_tags(tag_id, tags(id, name, color))')
        .in('workspace_id', ids)
        .gte('operation_date', dateFrom)
        .lte('operation_date', dateTo)
        .order('operation_date', { ascending: false });

      const { data: ops, error: opsErr } = await query;
      if (opsErr) throw opsErr;

      // Normalize tags from nested structure
      const normalized = (ops || []).map(op => ({
        ...op,
        tags: (op.tags || []).map(t => t.tags).filter(Boolean),
      }));

      // Load categories
      const { data: cats } = await supabase
        .from('categories')
        .select('id, name, type, color, is_archived')
        .in('workspace_id', ids);

      // Load tags
      const { data: tgs } = await supabase
        .from('tags')
        .select('id, name, color, is_archived')
        .in('workspace_id', ids);

      setOperations(normalized);
      setCategories(cats || []);
      setTags(tgs || []);
    } catch (e) {
      console.error('useAnalytics: load error', e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [idsKey, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const analytics = useMemo(
    () => computeAnalytics(operations, categories, tags),
    [operations, categories, tags]
  );

  return { analytics, operations, loading, error, refresh: load };
}
