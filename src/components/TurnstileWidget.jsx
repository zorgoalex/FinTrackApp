import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

const TURNSTILE_SCRIPT_ID = 'cloudflare-turnstile-script';
const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() || '';
export const TURNSTILE_REQUIRED_MESSAGE = 'Подтвердите, что вы не робот';
export const TURNSTILE_UNAVAILABLE_MESSAGE = 'Проверка безопасности не загрузилась. Проверьте соединение и блокировщики содержимого.';
export const isTurnstileEnabled = Boolean(TURNSTILE_SITE_KEY);

let turnstileScriptPromise;

function loadTurnstile() {
  if (globalThis.turnstile) return Promise.resolve(globalThis.turnstile);
  if (turnstileScriptPromise) return turnstileScriptPromise;

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(TURNSTILE_SCRIPT_ID);
    const script = existing || document.createElement('script');

    const handleLoad = () => {
      if (globalThis.turnstile) resolve(globalThis.turnstile);
      else reject(new Error('Turnstile API is unavailable'));
    };
    const handleError = () => reject(new Error('Turnstile script failed to load'));

    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });

    if (!existing) {
      script.id = TURNSTILE_SCRIPT_ID;
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }).catch((error) => {
    turnstileScriptPromise = undefined;
    throw error;
  });

  return turnstileScriptPromise;
}

const TurnstileWidget = forwardRef(function TurnstileWidget({ action, onTokenChange, onError }, ref) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const onTokenChangeRef = useRef(onTokenChange);
  const onErrorRef = useRef(onError);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    onTokenChangeRef.current = onTokenChange;
    onErrorRef.current = onError;
  }, [onError, onTokenChange]);

  useImperativeHandle(ref, () => ({
    reset() {
      onTokenChangeRef.current?.('');
      if (widgetIdRef.current !== null && globalThis.turnstile) {
        globalThis.turnstile.reset(widgetIdRef.current);
      }
    },
  }), []);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !containerRef.current) return undefined;

    let cancelled = false;
    setLoadError('');
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return;
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          action,
          appearance: 'interaction-only',
          execution: 'render',
          theme: 'auto',
          size: 'flexible',
          callback: (token) => onTokenChangeRef.current?.(token),
          'expired-callback': () => onTokenChangeRef.current?.(''),
          'timeout-callback': () => onTokenChangeRef.current?.(''),
          'error-callback': () => {
            onTokenChangeRef.current?.('');
            onErrorRef.current?.(TURNSTILE_UNAVAILABLE_MESSAGE);
          },
        });
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError(TURNSTILE_UNAVAILABLE_MESSAGE);
        onTokenChangeRef.current?.('');
        onErrorRef.current?.(TURNSTILE_UNAVAILABLE_MESSAGE);
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current !== null && globalThis.turnstile) {
        globalThis.turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
    };
  }, [action]);

  if (!TURNSTILE_SITE_KEY) return null;

  return (
    <div className="space-y-2">
      <div ref={containerRef} aria-label="Автоматическая проверка безопасности" />
      {loadError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{loadError}</p>}
    </div>
  );
});

export default TurnstileWidget;
