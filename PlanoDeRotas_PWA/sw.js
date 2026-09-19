const CACHE_NAME = "plano-rotas-v4";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Requests the service worker must never touch:
//  - Google/Firebase API traffic (Firestore live listeners and long-poll channels
//    are long-lived streaming GETs; caching them buffers memory and can replay
//    stale sync responses).
//  - OpenStreetMap map tiles (every tile viewed would otherwise be stored forever,
//    growing the cache without limit).
// The Firebase JS *libraries* live on www.gstatic.com, which is NOT excluded here,
// so they stay cached for offline use.
function shouldBypass(url) {
  const host = url.hostname;
  return (
    host.endsWith(".googleapis.com") ||
    host.endsWith(".firebaseio.com") ||
    host.endsWith("tile.openstreetmap.org")
  );
}

// Network-first: always try to fetch the latest version first.
// Only fall back to the cached copy if the device is offline.
// IMPORTANT: only GET requests can be cached — the browser's Cache API rejects
// any other method. Firestore's live data connection uses POST requests, so
// those (and any other non-GET request) must always pass straight through,
// untouched by the service worker, rather than being intercepted here.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }
  let url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return;
  }
  if (shouldBypass(url)) {
    return;
  }
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Only store good responses: normal 200s, and opaque ones (cross-origin
        // <script> tags without CORS). Never cache errors (404/500) or partial
        // (206) responses, which would later be served as if they were fine.
        if (response && (response.status === 200 || response.type === "opaque")) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          // Offline navigation to a URL that was never cached (e.g. index.html?x=1):
          // fall back to the cached app shell rather than a browser error page.
          if (request.mode === "navigate") {
            return caches.match("./index.html").then((shell) => shell || Response.error());
          }
          return Response.error();
        })
      )
  );
});
