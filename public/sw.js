// AllGood Service Worker — Push Notifications
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  const title = data.title || '🚨 אזעקה - AllGood';
  const options = {
    body: data.body || 'יש אזעקה באזור שלך',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [500, 200, 500, 200, 500],
    requireInteraction: true,
    tag: 'allgood-alert',
    renotify: true,
    data: { url: data.url || '/' },
    actions: [
      { action: 'safe', title: '✅ אני בסדר' },
      { action: 'open', title: '📱 פתח אפליקציה' }
    ]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  if (event.action === 'safe') {
    // Just close
    return;
  }
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
