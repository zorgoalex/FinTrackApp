import { Component, useEffect } from 'react';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';
import { useRouteError } from 'react-router-dom';

const STALE_CHUNK_PATTERN = /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|JavaScript-or-Wasm module script|MIME type of "text\/html"/i;
const RELOAD_KEY = 'fintrack_chunk_reload_at';

export function isStaleChunkError(error) {
  const message = [error?.message, error?.statusText, error?.error?.message, String(error || '')]
    .filter(Boolean)
    .join(' ');
  return STALE_CHUNK_PATTERN.test(message);
}

async function clearFinTrackCaches() {
  if (!('caches' in window)) return;
  const keys = await window.caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith('fintrack-')).map((key) => window.caches.delete(key)));
}

function reloadWithoutStaleCaches() {
  Promise.resolve(clearFinTrackCaches())
    .catch((error) => console.error('Failed to clear stale FinTrack caches', error))
    .finally(() => window.location.reload());
}

export function recoverFromStaleChunk(error) {
  if (!isStaleChunkError(error)) return false;
  const lastReload = Number(window.sessionStorage.getItem(RELOAD_KEY) || 0);
  if (Date.now() - lastReload <= 60_000) return false;
  window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  reloadWithoutStaleCaches();
  return true;
}

function ErrorScreen({ stale = false }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50 dark:bg-gray-900">
      <div className="card w-full max-w-md text-center">
        <AlertTriangle size={42} className="mx-auto mb-4 text-amber-500" />
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          {stale ? 'Приложение обновилось' : 'Не удалось открыть этот экран'}
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
          {stale
            ? 'Загружаем актуальную версию. Если страница не обновилась автоматически, нажмите кнопку ниже.'
            : 'Данные не потеряны. Обновите приложение; если ошибка повторится, вернитесь на главную страницу.'}
        </p>
        <div className="flex flex-col sm:flex-row justify-center gap-2">
          <button type="button" onClick={reloadWithoutStaleCaches} className="btn-primary">
            <RefreshCw size={16} className="mr-2" />
            Обновить
          </button>
          <button type="button" onClick={() => window.location.assign('/')} className="btn-secondary">
            <Home size={16} className="mr-2" />
            На главную
          </button>
        </div>
      </div>
    </div>
  );
}

export function RouteErrorBoundary() {
  const error = useRouteError();
  const stale = isStaleChunkError(error);

  useEffect(() => {
    console.error('React Router error', error);
    recoverFromStaleChunk(error);
  }, [error]);

  return <ErrorScreen stale={stale} />;
}

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled application error', error, info);
    recoverFromStaleChunk(error);
  }

  handleReload = () => {
    reloadWithoutStaleCaches();
  };

  handleGoHome = () => {
    window.location.assign('/');
  };

  render() {
    if (!this.state.error) return this.props.children;
    return <ErrorScreen stale={isStaleChunkError(this.state.error)} />;
  }
}
