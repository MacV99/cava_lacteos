// Service worker — Cava Panel
// Subir versión (v1 → v2) cada vez que cambie HTML/CSS/JS para forzar actualización.
const CACHE_NAME = "cava-panel-v6";
const ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/img/icon-192.png",
  "/img/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // No interceptar llamadas al Apps Script ni a nada fuera de este origen.
  if (!event.request.url.startsWith(self.location.origin)) return;

  // App shell: network-first para HTML (ver cambios al instante), cache fallback.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(event.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
