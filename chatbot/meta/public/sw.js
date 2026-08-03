// Service worker del Panel Cava.
// Estrategia: el "app shell" (HTML/CSS/JS) va network-first para que un deploy
// nuevo se vea al instante estando online, y cache como respaldo offline.
// Los assets estáticos (íconos, manifest) van cache-first. Los datos (/api/*)
// NUNCA se cachean: siempre a la red.
//
// La versión la inyecta el server en cada deploy (commit SHA de Render, ver
// main.py /sw.js). Así, cada push cambia estos bytes → el navegador detecta un SW
// nuevo, lo instala, hace skipWaiting y la app se recarga sola (ver index.html).
// En local/sin substituir queda el literal '__BUILD_ID__' (estable, no rompe).
const CACHE_VERSION = 'cava-__BUILD_ID__';
const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/img/icon-192.png',
  '/img/icon-512.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

function isShell(url) {
  return (
    url.pathname === '/' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js')
  );
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Última red para navegaciones offline: servir el index cacheado.
    if (request.mode === 'navigate') return cache.match('/index.html');
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;                       // POST/PUT: a la red
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;            // externo (fonts, Graph): a la red
  if (url.pathname.startsWith('/api/')) return;               // datos en vivo: nunca cache
  if (url.pathname === '/webhook' || url.pathname === '/healthz') return;

  if (request.mode === 'navigate' || isShell(url)) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(cacheFirst(request));
  }
});
