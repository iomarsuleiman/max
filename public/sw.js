/* Never cache pages, API responses, credentials or private workspace content. */
const CACHE = "max-offline-v3";
const FILES = ["/offline.html", "/offline-game.js"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES))));
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches.keys().then(async (keys) => {
      for (const key of keys) if (key.startsWith("max-offline-") && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    }),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (FILES.includes(url.pathname)) {
    event.respondWith(caches.match(url.pathname).then((cached) => cached || fetch(event.request)));
    return;
  }
  if (event.request.mode === "navigate") event.respondWith(fetch(event.request).catch(() => caches.match("/offline.html")));
});
