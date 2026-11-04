/* NARI Smart Home - service worker.
 * Network-first for navigation & app shell so updates appear immediately.
 * Fallback to cache when offline (works offline / on LAN with no internet). */
const CACHE_VERSION = "nari-shell-v2.4.0";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/app.css?v=2.4.0",
  "./js/config.js?v=2.4.0",
  "./js/store.js?v=2.4.0",
  "./js/transport.js?v=2.4.0",
  "./js/audio.js?v=2.4.0",
  "./js/sensors.js?v=2.4.0",
  "./js/scenes.js?v=2.4.0",
  "./js/app.js?v=2.4.0",
  "./js/sharing.js?v=2.4.0",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./vendor/fontawesome/css/all.min.css",
  "./vendor/fontawesome/webfonts/fa-solid-900.woff2",
  "./vendor/fontawesome/webfonts/fa-brands-400.woff2",
  "./vendor/fontawesome/webfonts/fa-regular-400.woff2",
  "./vendor/js/mqtt.min.js",
  "./vendor/js/firebase-app-compat.js",
  "./vendor/js/firebase-auth-compat.js",
  "./vendor/js/firebase-firestore-compat.js",
  "./vendor/js/qrcode.min.js"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => Promise.all(APP_SHELL.map((url) => cache.add(url).catch(() => null))))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Firmware binaries: always go to network
  if (url.pathname.includes("/firmware/")) return;

  // Network-first for navigation (HTML page): always get latest deployed version if online
  if (req.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname === "/") {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(async () => {
        return (await caches.match("./index.html")) ||
               (await caches.match("./")) ||
               (await caches.match("/index.html")) ||
               (await caches.match(req, { ignoreSearch: true }));
      })
    );
    return;
  }

  // Network-first for CSS and JS to prevent stale UI
  if (url.pathname.endsWith(".css") || url.pathname.endsWith(".js")) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }))
    );
    return;
  }

  // Cache-first for images and fonts
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
