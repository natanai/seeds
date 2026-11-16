"use strict";

// Bump the version when changing the files in the offline snapshot.
const CACHE = "meaningful-seeds-v10";
const SCOPE = new URL(self.registration.scope);
const START = new URL("index.html", SCOPE).href;
const assets = new Set([
  "index.html", "style.css?v=10", "packed-text.js?v=10", "seed-core.js?v=10", "seed-trace.js?v=10", "app.js?v=10",
  "manifest.webmanifest", "icon-192.png", "icon-512.png"
].map((path) => new URL(path, SCOPE).href));

self.addEventListener("install", (event) => {
  const snapshot = [...assets].map((url) => new Request(url, { cache: "reload" }));
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(snapshot))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  const discardOldVersions = caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith("meaningful-seeds-") && key !== CACHE)
      .map((key) => caches.delete(key))
  ));
  event.waitUntil(discardOldVersions.then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const home = request.mode === "navigate" && url.origin === SCOPE.origin &&
    (url.pathname === SCOPE.pathname || url.pathname === new URL(START).pathname);
  if (!home && !assets.has(url.href)) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.status < 500) return response;
    } catch {
      // The installed snapshot works when the network is unavailable.
    }
    const cache = await caches.open(CACHE);
    return await cache.match(home ? START : request) ?? Response.error();
  })());
});
