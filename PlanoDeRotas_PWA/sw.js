// Gerado/atualizado por build.py — APP_BUILD e a lista SHELL mudam a cada versão.
const APP_BUILD = "2026-11-28-rapido";
const CACHE_NAME = "plano-rotas-" + APP_BUILD;   // ficheiros da app (muda a cada versão)
const LIB_CACHE = "plano-rotas-libs-v1";          // bibliotecas com versão fixa (nunca mudam)
const SHELL = ["./", "./index.html", "./app.min.js?v=2026-11-28-rapido", "./tailwind.css?v=2026-11-28", "./manifest.webmanifest", "./icon-192.png", "./icon-160.png"];
const HTML_TIMEOUT_MS = 3000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== LIB_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Requests the service worker must never touch:
//  - Google/Firebase API traffic (Firestore live listeners and long-poll channels
//    are long-lived streaming GETs; caching them buffers memory and can replay
//    stale sync responses).
//  - OpenStreetMap map tiles (every tile viewed would otherwise be stored forever,
//    growing the cache without limit).
//  - version.json (the "new version" check): always live, and never stored, because every
//    check has a unique ?_v= and would otherwise pile up in the cache.
function shouldBypass(url) {
  const host = url.hostname;
  return (
    url.pathname.endsWith("/version.json") ||
    host.endsWith(".googleapis.com") ||
    host.endsWith(".firebaseio.com") ||
    host.endsWith("tile.openstreetmap.org")
  );
}

// Files whose URL carries a fixed version never change, so the cached copy is always right:
// react@18.3.1, leaflet@1.9.4, firebasejs/12.19.0/, jspdf/4.2.1/, xlsx-0.20.3/, and our own files with ?v=
function isPinned(url) {
  return /@\d+\.\d+\.\d+\//.test(url.pathname) ||
    /\/\d+\.\d+\.\d+\//.test(url.pathname) ||
    /-\d+\.\d+\.\d+\//.test(url.pathname) ||
    /[?&]v=/.test(url.search);
}

// Only store good responses: normal 200s, and opaque ones (cross-origin <script> tags
// without CORS). Never cache errors (404/500) or partial (206) responses.
function store(cacheName, request, response) {
  if (response && (response.status === 200 || response.type === "opaque")) {
    const copy = response.clone();
    caches.open(cacheName).then((cache) => cache.put(request, copy)).catch(() => {});
  }
  return response;
}

function offlineFallback(request) {
  return caches.match(request).then((cached) => {
    if (cached) return cached;
    // Offline navigation to a URL that was never cached (e.g. index.html?x=1):
    // fall back to the cached app shell rather than a browser error page.
    if (request.mode === "navigate") {
      return caches.match("./index.html").then((shell) => shell || Response.error());
    }
    return Response.error();
  });
}

// IMPORTANT: only GET requests can be cached — Firestore's POSTs pass straight through.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  let url;
  try { url = new URL(request.url); } catch (e) { return; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  if (shouldBypass(url)) return;

  // 1) Versioned files: cache first (instant, works offline), network only the first time.
  if (isPinned(url)) {
    const own = url.origin === self.location.origin;
    event.respondWith(
      caches.match(request).then((cached) => cached ||
        fetch(request).then((r) => store(own ? CACHE_NAME : LIB_CACHE, request, r)))
    );
    return;
  }

  // 2) Everything else (index.html, version.json, icons…): network first, so updates arrive
  //    straight away. For the page itself, if the network takes longer than 3 s (weak signal),
  //    open the cached copy instead; the network answer still refreshes the cache for next time.
  const network = fetch(request).then((r) => store(CACHE_NAME, request, r));
  if (request.mode === "navigate") {
    event.respondWith(new Promise((resolve) => {
      let done = false;
      const finish = (r) => { if (!done && r) { done = true; resolve(r); } };
      const timer = setTimeout(() => {
        caches.match(request).then((c) => c || caches.match("./index.html")).then(finish);
      }, HTML_TIMEOUT_MS);
      network.then((r) => { clearTimeout(timer); finish(r); })
        .catch(() => { clearTimeout(timer); offlineFallback(request).then(finish); });
    }));
    event.waitUntil(network.catch(() => {}));
    return;
  }
  event.respondWith(network.catch(() => offlineFallback(request)));
});
