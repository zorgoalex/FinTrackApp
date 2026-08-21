export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const IDLE_WARNING_MS = 2 * 60 * 1000;
export const IDLE_ACTIVITY_WRITE_THROTTLE_MS = 15 * 1000;
export const IDLE_ACTIVITY_STORAGE_KEY = 'fintrack:session-last-activity';
export const IDLE_EXPIRED_STORAGE_KEY = 'fintrack:session-expired';

export function getIdleSessionState(lastActivityAt, now = Date.now()) {
  const lastActivity = Number(lastActivityAt);
  const currentTime = Number(now);
  if (!Number.isFinite(lastActivity) || !Number.isFinite(currentTime)) {
    return { expired: false, warning: false, remainingMs: IDLE_TIMEOUT_MS, remainingSeconds: IDLE_TIMEOUT_MS / 1000 };
  }

  const remainingMs = Math.max(0, IDLE_TIMEOUT_MS - Math.max(0, currentTime - lastActivity));
  return {
    expired: remainingMs === 0,
    warning: remainingMs > 0 && remainingMs <= IDLE_WARNING_MS,
    remainingMs,
    remainingSeconds: Math.ceil(remainingMs / 1000),
  };
}

export function formatIdleCountdown(seconds) {
  const safeSeconds = Math.max(0, Math.ceil(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  return `${minutes}:${String(safeSeconds % 60).padStart(2, '0')}`;
}
