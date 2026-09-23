/* Sabeel driver app service worker.
 *
 * Purpose: let the driver app open and work with no signal. It caches only the app shell:
 *   - the /driver page (network first, so updates arrive; cached copy used when offline)
 *   - Next.js static assets (stale-while-revalidate) and the app icons
 * It never touches /api/*: job data and queued actions live in IndexedDB, managed by the app itself.
 * The /driver HTML contains no personal data. On sign-out the app deletes every "sabeel-driver-*" cache.
 */
const SHELL = "sabeel-driver-shell-v1";
const ASSETS = "sabeel-driver-assets-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, ASSETS]);
      for (const k of await caches.keys()) if (k.startsWith("sabeel-driver") && !keep.has(k)) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // never cache data

  // The app page: prefer the network, fall back to the last good copy.
  if (req.mode === "navigate" && url.pathname === "/driver") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL);
        try {
          const fresh = await fetch(req);
          // Only keep a real page (not a redirect to the sign-in screen).
          if (fresh.ok && !fresh.redirected) cache.put("/driver", fresh.clone());
          return fresh;
        } catch {
          const cached = await cache.match("/driver");
          if (cached) return cached;
          return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
        }
      })(),
    );
    return;
  }

  // Static files the page needs: serve from cache immediately, refresh in the background.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname === "/driver.webmanifest") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSETS);
        const cached = await cache.match(req);
        const refresh = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => null);
        return cached || (await refresh) || new Response("", { status: 504 });
      })(),
    );
  }
});
