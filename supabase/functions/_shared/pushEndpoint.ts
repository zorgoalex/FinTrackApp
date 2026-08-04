const EXACT_HOSTS = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
]);

export function isAllowedWebPushEndpoint(value: string) {
  try {
    const endpoint = new URL(value);
    const hostname = endpoint.hostname.toLowerCase();
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.port) return false;
    if (EXACT_HOSTS.has(hostname)) {
      if (hostname === 'fcm.googleapis.com') return endpoint.pathname.startsWith('/fcm/send/') || endpoint.pathname.startsWith('/wp/');
      if (hostname === 'updates.push.services.mozilla.com') return endpoint.pathname.startsWith('/wpush/');
      return endpoint.pathname.startsWith('/');
    }
    return /^[a-z0-9-]+\.notify\.windows\.com$/.test(hostname) && endpoint.pathname.startsWith('/w/');
  } catch {
    return false;
  }
}
