const CACHE = "badminton-tools-v12-runtime";
const CORE = [
  "./",
  "./index.html",
  "./app-v12.js",
  "./style-v12.css",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(CORE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isCritical =
    event.request.mode === "navigate" ||
    url.pathname.endsWith("/app-v12.js") ||
    url.pathname.endsWith("/style-v12.css") ||
    url.pathname.endsWith("/index.html");

  if (sameOrigin && isCritical) {
    // Critical app files: newest network copy first. Cache only as offline fallback.
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(event.request).then(cached =>
            cached || caches.match("./index.html")
          )
        )
    );
    return;
  }

  // Non-critical static files: cache-first is fine.
  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).then(response => {
        if (response && response.ok && sameOrigin) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
    )
  );
});