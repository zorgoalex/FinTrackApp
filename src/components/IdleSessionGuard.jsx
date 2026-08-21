import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock3 } from 'lucide-react';
import {
  formatIdleCountdown,
  getIdleSessionState,
  IDLE_ACTIVITY_STORAGE_KEY,
  IDLE_ACTIVITY_WRITE_THROTTLE_MS,
  IDLE_EXPIRED_STORAGE_KEY,
} from '../utils/idleSession';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart'];

function readStoredActivity() {
  if (typeof localStorage === 'undefined') return null;
  const value = Number(localStorage.getItem(IDLE_ACTIVITY_STORAGE_KEY));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export default function IdleSessionGuard({ active, onTimeout }) {
  const [remainingSeconds, setRemainingSeconds] = useState(null);
  const lastActivityRef = useRef(Date.now());
  const lastPersistedRef = useRef(0);
  const timeoutStartedRef = useRef(false);
  const onTimeoutRef = useRef(onTimeout);

  useEffect(() => { onTimeoutRef.current = onTimeout; }, [onTimeout]);

  const recordActivity = useCallback((forcePersist = false) => {
    if (!active || timeoutStartedRef.current) return;
    const now = Date.now();
    lastActivityRef.current = now;
    setRemainingSeconds(null);
    if (forcePersist || now - lastPersistedRef.current >= IDLE_ACTIVITY_WRITE_THROTTLE_MS) {
      localStorage.setItem(IDLE_ACTIVITY_STORAGE_KEY, String(now));
      lastPersistedRef.current = now;
    }
  }, [active]);

  const startTimeout = useCallback(() => {
    if (timeoutStartedRef.current) return;
    timeoutStartedRef.current = true;
    setRemainingSeconds(0);
    Promise.resolve(onTimeoutRef.current?.()).catch((error) => {
      console.error('IdleSessionGuard: sign-out failed', error);
    });
  }, []);

  useEffect(() => {
    if (!active) {
      timeoutStartedRef.current = false;
      setRemainingSeconds(null);
      return undefined;
    }

    timeoutStartedRef.current = false;
    const storedActivity = readStoredActivity();
    const now = Date.now();
    lastActivityRef.current = storedActivity && storedActivity <= now ? storedActivity : now;
    recordActivity(true);

    const handleActivity = (event) => {
      if (event.target instanceof globalThis.Element && event.target.closest('[data-idle-session-dialog]')) return;
      recordActivity();
    };
    const handleStorage = (event) => {
      if (event.key === IDLE_EXPIRED_STORAGE_KEY && event.newValue) {
        startTimeout();
        return;
      }
      if (event.key !== IDLE_ACTIVITY_STORAGE_KEY || !event.newValue || timeoutStartedRef.current) return;
      const activityAt = Number(event.newValue);
      if (!Number.isFinite(activityAt) || activityAt <= 0) return;
      lastActivityRef.current = activityAt;
      lastPersistedRef.current = activityAt;
      setRemainingSeconds(null);
    };
    const checkTimeout = () => {
      const state = getIdleSessionState(lastActivityRef.current);
      if (state.expired) {
        startTimeout();
      } else {
        setRemainingSeconds(state.warning ? state.remainingSeconds : null);
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') checkTimeout();
    };

    ACTIVITY_EVENTS.forEach((eventName) => window.addEventListener(eventName, handleActivity, { passive: true }));
    window.addEventListener('storage', handleStorage);
    document.addEventListener('visibilitychange', handleVisibility);
    const intervalId = window.setInterval(checkTimeout, 1000);
    checkTimeout();

    return () => {
      ACTIVITY_EVENTS.forEach((eventName) => window.removeEventListener(eventName, handleActivity));
      window.removeEventListener('storage', handleStorage);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.clearInterval(intervalId);
    };
  }, [active, recordActivity, startTimeout]);

  if (!active || remainingSeconds === null || timeoutStartedRef.current) return null;

  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="idle-session-title" data-idle-session-dialog>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-800">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
            <Clock3 size={21} aria-hidden="true" />
          </span>
          <div>
            <h2 id="idle-session-title" className="font-semibold">Сессия скоро завершится</h2>
            <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-300">
              Вы будете автоматически выведены через <strong>{formatIdleCountdown(remainingSeconds)}</strong> из-за отсутствия активности.
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <button type="button" className="btn-secondary min-h-11" onClick={startTimeout}>Выйти сейчас</button>
          <button type="button" className="btn-primary min-h-11" onClick={() => recordActivity(true)} autoFocus>Продолжить работу</button>
        </div>
      </div>
    </div>
  );
}
