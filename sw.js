/* NARI Smart Home - service worker.
 * Cache-first for the static app shell (works offline / on LAN with no internet).
 * Network-first for the firmware manifest so update checks are never stale.
 * Only same-origin GETs are handled; LAN device calls and MQTT WebSockets are untouched.
 * Bump CACHE_VERSION on every release so installed apps pick up new files. */
const CACHE_VERSION = "nari-shell-v1.2.4";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/app.css",
  "./js/config.js",
  "./js/store.js",
  "./js/transport.js",
  "./js/audio.js",
  "./js/sensors.js",
  "./js/scenes.js",
  "./js/app.js",
  "./js/sharing.js",
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
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // Cache each file independently so one missing optional file (e.g. config.local.js) never aborts install.
      .then((cache) => Promise.all(APP_SHELL.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
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

  // Firmware manifest / binaries: always go to the network.
  if (url.pathname.includes("/firmware/")) return;

  // Deployment config holds per-deployment values: prefer fresh, fall back to cache.
  if (url.pathname.endsWith("/js/config.local.js")) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => (req.mode === "navigate" ? caches.match("./index.html") : undefined));
    })
  );
});
