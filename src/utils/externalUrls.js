export function safeTelegramUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.hostname !== 't.me' || url.username || url.password || url.port || url.hash) return null;
    if (!/^\/[A-Za-z0-9_]{5,32}$/u.test(url.pathname)) return null;
    const params = [...url.searchParams.keys()];
    if (params.some((key) => key !== 'start') || !/^[A-Za-z0-9_-]{8,256}$/u.test(url.searchParams.get('start') || '')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function safePublicHttpsEndpoint(value) {
  try {
    const url = new URL(String(value || '').trim());
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return null;
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) return null;
    if (/^(?:127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/u.test(hostname)) return null;
    if (/^\[.*\]$/u.test(hostname) || /^\d+(?:\.\d+){3}$/u.test(hostname)) return null;
    return url.origin + url.pathname.replace(/\/+$/u, '');
  } catch {
    return null;
  }
}
