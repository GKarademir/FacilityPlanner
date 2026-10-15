// Facility Planer · Author: Geray S. Karademir

/**
 * Service worker: keeps the app shell in a cache so the app starts and works offline.
 * Bump VERSION with every release so installed apps pick up the new files.
 */
const VERSION = "v3";
const CACHE = `facilityplaner-${VERSION}`;

const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/app.css",
  "js/app.js",
  "js/agenda.js",
  "js/backup.js",
  "js/day.js",
  "js/dialogs.js",
  "js/fmt.js",
  "js/icons.js",
  "js/recurrence.js",
  "js/reminders.js",
  "js/report.js",
  "js/store.js",
  "icons/icon-32.png",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("facilityplaner-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first (so updates arrive right away when online), cache as fallback when offline.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then((hit) => hit ?? (req.mode === "navigate" ? caches.match("index.html") : Response.error()))),
  );
});

// Tapping the daily reminder opens (or focuses) the app on "Heute".
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? "./", self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const client = list.find((c) => c.url.startsWith(self.registration.scope));
      if (client) {
        client.navigate(url).catch(() => {});
        return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
