import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../contexts/AuthContext';

export default function useOperationComments(operationId) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!operationId) {
      setComments([]);
      return;
    }
    setLoading(true);
    setError('');
    const { data, error: loadError } = await supabase
      .from('operation_comments')
      .select('id, workspace_id, operation_id, author_id, body, kind, created_at, updated_at')
      .eq('operation_id', operationId)
      .order('created_at', { ascending: true });
    if (loadError) setError(loadError.message);
    else setComments(data || []);
    setLoading(false);
  }, [operationId]);

  useEffect(() => { load(); }, [load]);

  const addComment = useCallback(async ({ workspaceId, authorId, body, kind = 'user' }) => {
    const normalized = body.trim();
    if (!normalized) return null;
    const { data, error: insertError } = await supabase
      .from('operation_comments')
      .insert({ workspace_id: workspaceId, operation_id: operationId, author_id: authorId, body: normalized, kind })
      .select('id, workspace_id, operation_id, author_id, body, kind, created_at, updated_at')
      .single();
    if (insertError) throw insertError;
    setComments((current) => [...current, data]);
    return data;
  }, [operationId]);

  const deleteComment = useCallback(async (commentId) => {
    const { error: deleteError } = await supabase.from('operation_comments').delete().eq('id', commentId);
    if (deleteError) throw deleteError;
    setComments((current) => current.filter((comment) => comment.id !== commentId));
  }, []);

  return { comments, loading, error, addComment, deleteComment };
}
