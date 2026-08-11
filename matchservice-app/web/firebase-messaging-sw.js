// Firebase Cloud Messaging service worker.
//
// The browser looks for this file at exactly this path (/firebase-messaging-sw.js)
// and will not deliver a background push without it — it is what receives the
// message when the tab is closed or in another window.
//
// It runs outside the Flutter bundle, so it cannot read firebase_options.dart
// and the config has to be repeated here. Keep both in sync when the Firebase
// project changes. These values are public client config, not secrets.
//
// The compat SDK is used deliberately: a service worker cannot use ES module
// imports across importScripts, which is what the modular SDK requires.
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyD9NZauoLfMxvDugu0DZe99_0mVf6-Lpgw',
  authDomain: 'vibematch-42981.firebaseapp.com',
  projectId: 'vibematch-42981',
  storageBucket: 'vibematch-42981.firebasestorage.app',
  messagingSenderId: '15459176528',
  appId: '1:15459176528:web:2317cc953ca8b26ca00155',
});

const messaging = firebase.messaging();

// Only data-only messages reach this handler; a push carrying a `notification`
// block is rendered by the browser itself, and showing our own on top would
// display the same alert twice.
messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification ?? {};
  if (!title) return;
  self.registration.showNotification(title, {
    body: body ?? '',
    icon: 'icons/Icon-192.png',
    data: payload.data ?? {},
  });
});

// Tapping the notification focuses an already-open tab instead of opening a
// second one, then hands the payload to the app so it can deep-link.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            client.postMessage({ type: 'notification-click', data: event.notification.data });
            return client.focus();
          }
        }
        return self.clients.openWindow('/');
      }),
  );
});
