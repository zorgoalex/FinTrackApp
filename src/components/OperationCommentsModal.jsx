import { useState } from 'react';
import { MessageSquare, PackageSearch, Send, Trash2, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import useOperationComments from '../hooks/useOperationComments';

function formatDate(value) {
  return new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

export default function OperationCommentsModal({ operation, workspaceId, canComment, canManage, onClose, onChanged }) {
  const { user } = useAuth();
  const { comments, loading, error, addComment, deleteComment } = useOperationComments(operation?.id);
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (!body.trim() || saving) return;
    setSaving(true);
    setActionError('');
    try {
      await addComment({ workspaceId, authorId: user.id, body });
      setBody('');
      onChanged?.();
    } catch (submitError) {
      setActionError(submitError.message || 'Не удалось добавить комментарий');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (comment) => {
    setActionError('');
    try {
      await deleteComment(comment.id);
      onChanged?.();
    } catch (deleteError) {
      setActionError(deleteError.message || 'Не удалось удалить комментарий');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="comments-title">
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl dark:bg-gray-800 sm:max-w-xl sm:rounded-2xl sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary-600">Операция</p>
            <h2 id="comments-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">Комментарии</h2>
            <p className="text-sm text-gray-500">{operation.description || `${operation.amount} ${operation.currency || ''}`}</p>
          </div>
          <button type="button" onClick={onClose} className="grid min-h-11 min-w-11 place-items-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Закрыть комментарии"><X size={20} /></button>
        </div>

        <div className="mt-4 space-y-3">
          {loading && <p className="text-sm text-gray-500">Загрузка комментариев…</p>}
          {!loading && !comments.length && <div className="rounded-xl border border-dashed border-gray-300 p-5 text-center text-sm text-gray-500 dark:border-gray-600"><MessageSquare className="mx-auto mb-2" size={22} />Комментариев пока нет</div>}
          {comments.map((comment) => {
            const canDelete = canManage || comment.author_id === user?.id;
            return (
              <article key={comment.id} className={`rounded-xl border p-3 ${comment.kind === 'receipt_items' ? 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20' : 'border-gray-200 dark:border-gray-700'}`}>
                <div className="mb-2 flex items-center justify-between gap-2 text-xs text-gray-500">
                  <span className="flex items-center gap-1">{comment.kind === 'receipt_items' && <PackageSearch size={14} />} {comment.kind === 'receipt_items' ? 'Позиции из чека · ' : ''}{comment.author_id === user?.id ? 'Вы' : 'Участник'} · {formatDate(comment.created_at)}</span>
                  {canDelete && <button type="button" onClick={() => remove(comment)} className="grid min-h-9 min-w-9 place-items-center rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30" aria-label="Удалить комментарий"><Trash2 size={15} /></button>}
                </div>
                <p className="whitespace-pre-wrap break-words text-sm text-gray-800 dark:text-gray-200">{comment.body}</p>
              </article>
            );
          })}
        </div>

        {(error || actionError) && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{actionError || error}</p>}

        {canComment ? <form onSubmit={submit} className="sticky bottom-0 mt-4 border-t border-gray-200 bg-white pt-3 dark:border-gray-700 dark:bg-gray-800">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Новый комментарий
            <textarea className="input-field mt-1 min-h-24 resize-y" maxLength={5000} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Например: сверено с первичным документом" />
          </label>
          <div className="mt-2 flex items-center justify-between gap-3"><span className="text-xs text-gray-400">{body.length} / 5000</span><button type="submit" disabled={!body.trim() || saving} className="btn-primary flex min-h-11 items-center gap-2 disabled:opacity-50"><Send size={16} />{saving ? 'Сохраняем…' : 'Добавить'}</button></div>
        </form> : <p className="mt-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-500 dark:bg-gray-900/40">Роль «Наблюдатель» может читать комментарии, но не добавлять их.</p>}
      </div>
    </div>
  );
}
