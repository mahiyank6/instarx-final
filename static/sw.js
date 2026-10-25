/* InstaRX service worker.
   Caches the app shell so it opens instantly and survives a flaky connection.
   API calls always go to the network — stale medicine or order data would be
   worse than no data. */

const CACHE = "instarx-shell-v4";
const SHELL = [
  "/app.html",
  "/css/style.css",
  "/css/app.css",
  "/js/common.js",
  "/js/app.js",
  "/js/illustrations.js",
  "/img/icon-192.png",
  "/img/icon-512.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  // Never serve stale API data.
  if (url.pathname.startsWith("/api/")) return;

  // Product photos: cache-first, they never change once downloaded.
  if (url.pathname.startsWith("/media/")) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() => hit))
    );
    return;
  }

  // Shell: network-first so updates land, falling back to cache offline.
  // `no-store` skips the browser's own HTTP cache too; without it a stale
  // script could be handed back as if it were fresh.
  e.respondWith(
    fetch(e.request, { cache: "no-store" }).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match("/app.html")))
  );
});
