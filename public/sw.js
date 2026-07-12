const CACHE_VERSION = 'fintrack-shell-v1';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/app-icon.svg', '/favicon.svg'];

globalThis.addEventListener('install', (event) => {
  event.waitUntil(globalThis.caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)));
  globalThis.skipWaiting();
});

globalThis.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    globalThis.caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => globalThis.caches.delete(key)))),
    globalThis.clients.claim(),
  ]));
});

globalThis.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new globalThis.URL(request.url);
  if (url.origin !== globalThis.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      globalThis.fetch(request)
        .then((response) => {
          const copy = response.clone();
          globalThis.caches.open(CACHE_VERSION).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => globalThis.caches.match('/index.html'))
    );
    return;
  }

  event.respondWith(
    globalThis.caches.match(request).then((cached) => {
      const network = globalThis.fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          globalThis.caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

globalThis.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = { body: event.data?.text() || '' };
  }
  const title = payload.title || 'ФинУчёт';
  event.waitUntil(globalThis.registration.showNotification(title, {
    body: payload.body || 'У вас новое финансовое напоминание',
    icon: '/app-icon.svg',
    badge: '/app-icon.svg',
    tag: payload.tag || 'fintrack-notification',
    renotify: Boolean(payload.renotify),
    data: { url: payload.url || '/cashflow' },
  }));
});

globalThis.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new globalThis.URL(event.notification.data?.url || '/', globalThis.location.origin).href;
  event.waitUntil(globalThis.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => client.url.startsWith(globalThis.location.origin));
    if (existing) {
      existing.navigate(target);
      return existing.focus();
    }
    return globalThis.clients.openWindow(target);
  }));
});
