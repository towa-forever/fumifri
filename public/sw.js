const CACHE_PREFIX = 'fumifri-';
let CACHE = 'fumifri-v1';

async function getVersion() {
  try {
    const res = await fetch('/api/version');
    const { v } = await res.json();
    return CACHE_PREFIX + v;
  } catch(e) {
    return CACHE;
  }
}

self.addEventListener('install', e => {
  e.waitUntil(
    getVersion().then(ver => {
      CACHE = ver;
      return caches.open(ver).then(c => c.addAll(['/']));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => !k.startsWith(CACHE_PREFIX) || k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/')) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

self.addEventListener('push', e => {
  const data = e.data.json();
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png'
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow('/'));
});

self.addEventListener('message', e => {
  if(e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
