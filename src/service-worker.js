// Service worker (gira nel browser). server.js lo serve come /sw.js dopo aver
// inserito la versione e l'elenco dei file dell'app: così l'app si apre subito
// dalla memoria del telefono (anche mentre il server gratuito si risveglia, o
// senza rete) e scarica di nuovo i file solo quando cambiano.

const VERSION = "__VERSION__";
const ASSETS = ["__ASSETS__"];
const SHELL = `shell-${VERSION}`; // the app itself
const DATA = `data-${VERSION}`; // rules, card searches and server status already fetched
const MAX_DATA = 400;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // "no-cache": revalidate with the server instead of copying stale HTTP-cache entries.
      await cache.addAll(ASSETS.map((url) => new Request(url, { cache: "no-cache" })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== SHELL && key !== DATA) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Questions to the judge (POST) and other sites always go to the network.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate") event.respondWith(cacheFirst(SHELL, "/", request));
  else if (url.pathname === "/api/health") event.respondWith(networkFirst(request));
  else if (url.pathname.startsWith("/api/rules") || url.pathname.startsWith("/api/cards"))
    event.respondWith(cacheFirst(DATA, request, request));
  else if (!url.pathname.startsWith("/api/")) event.respondWith(cacheFirst(SHELL, request, request));
});

/** From the cache if there; otherwise from the network, keeping a copy. */
async function cacheFirst(name, key, request) {
  const cache = await caches.open(name);
  const hit = await cache.match(key, { ignoreSearch: request.mode === "navigate" });
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(key, response.clone());
    if (name === DATA) trim(cache);
  }
  return response;
}

/** Fresh from the network when possible, the last copy when offline. */
async function networkFirst(request) {
  const cache = await caches.open(DATA);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) ?? Response.error();
  }
}

/** Keep the lookups cache bounded: the oldest entries go first. */
async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_DATA))) await cache.delete(key);
}
