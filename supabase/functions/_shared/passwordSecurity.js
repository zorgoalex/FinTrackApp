export const PWNED_PASSWORD_MESSAGE = 'Этот пароль найден в известных утечках. Придумайте другой пароль.';
export const PASSWORD_CHECK_UNAVAILABLE_MESSAGE = 'Проверка безопасности пароля временно недоступна. Повторите позже.';

const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/';

export async function sha1Hex(value) {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function findPwnedCount(rangeBody, expectedSuffix) {
  for (const line of String(rangeBody || '').split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    const suffix = line.slice(0, separator).trim().toUpperCase();
    if (suffix !== expectedSuffix) continue;
    const count = Number.parseInt(line.slice(separator + 1).trim(), 10);
    return Number.isFinite(count) && count > 0 ? count : 0;
  }
  return 0;
}

export async function checkPwnedPassword(password, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  const hash = await sha1Hex(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${HIBP_RANGE_URL}${prefix}`, {
      method: 'GET',
      headers: {
        'Add-Padding': 'true',
        'User-Agent': 'FinTrackApp-password-security',
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HIBP status ${response.status}`);
    const body = await response.text();
    return { pwned: findPwnedCount(body, suffix) > 0 };
  } catch {
    const error = new Error(PASSWORD_CHECK_UNAVAILABLE_MESSAGE);
    error.code = 'PASSWORD_CHECK_UNAVAILABLE';
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
