import { AlertTriangle, CloudOff, RefreshCw, Trash2 } from 'lucide-react';
import useOfflineQueue from '../hooks/useOfflineQueue';

export default function OfflineQueueStatus({ workspaceId }) {
  const queue = useOfflineQueue(workspaceId);
  const failures = queue.items.filter((item) => item.state === 'failed');
  if (queue.online && queue.items.length === 0) return null;

  return (
    <aside className="sticky top-[69px] z-20 border-b border-amber-200 bg-amber-50 px-4 py-2 text-amber-950 shadow-sm dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100 lg:top-0" aria-live="polite">
      <div className="mx-auto flex max-w-7xl items-center gap-2 text-sm">
        {queue.online ? <AlertTriangle size={17} /> : <CloudOff size={17} />}
        <span className="flex-1">
          {!queue.online
            ? `Офлайн: расходы сохранятся на устройстве${queue.items.length ? `. В очереди: ${queue.items.length}` : ''}`
            : failures.length
              ? `Не удалось синхронизировать: ${failures.length}. Проверьте изменённые справочники.`
              : `Синхронизация расходов: ${queue.items.length}`}
        </span>
        {queue.online && queue.items.length > 0 && (
          <button type="button" onClick={queue.sync} disabled={queue.syncing} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 font-medium hover:bg-amber-100 disabled:opacity-50 dark:hover:bg-amber-900">
            <RefreshCw size={15} className={queue.syncing ? 'animate-spin' : ''} /> Повторить
          </button>
        )}
      </div>
      {failures.length > 0 && (
        <details className="mx-auto mt-1 max-w-7xl text-xs">
          <summary className="cursor-pointer font-medium">Показать ошибки</summary>
          <ul className="mt-2 space-y-1">
            {failures.map((item) => (
              <li key={item.client_request_id} className="flex items-center gap-2 rounded-lg bg-white/60 px-2 py-1 dark:bg-black/20">
                <span className="flex-1">{item.payload.p_description || 'Расход'}: {item.payload.p_amount} {item.payload.p_currency} — {item.error}</span>
                <button type="button" onClick={() => queue.retry(item.client_request_id)} className="min-h-8 rounded px-2 hover:bg-amber-100 dark:hover:bg-amber-900">Повторить</button>
                <button type="button" onClick={() => queue.remove(item.client_request_id)} className="grid min-h-8 min-w-8 place-items-center rounded hover:bg-red-100 dark:hover:bg-red-950" aria-label="Удалить расход из offline-очереди"><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  );
}
