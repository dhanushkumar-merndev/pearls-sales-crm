// Pearl Aesthetic & Wellness Clinic -- offline-viewing service worker.
//
// Scope on purpose: cache only the offline shell and versioned static assets.
// Authenticated pages, React Server Component payloads and /api responses may
// contain patient, finance or live-stock data. They must never be persisted by
// a shared service-worker cache or served stale to another staff account.
//
// Bump CACHE_VERSION on any change to the caching strategy below so old
// clients pick up the new worker instead of running stale logic forever.
const CACHE_VERSION = "v3";
const PAGE_CACHE = `pearl-pages-${CACHE_VERSION}`;
const ASSET_CACHE = `pearl-assets-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(PAGE_CACHE).then((cache) => cache.add(OFFLINE_URL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== PAGE_CACHE && key !== ASSET_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Never intercept anything that isn't a plain GET -- every Server Action
  // (dispense, payment, consultation save, ...) is a POST and must always
  // go straight to the network, succeed or fail honestly.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Cross-origin (Supabase auth/storage, WHO's API, Google Fonts' own CDN,
  // etc.) is left alone -- caching someone else's origin here would not
  // help offline viewing and could serve stale auth state.
  if (url.origin !== self.location.origin) return;

  // Authenticated navigations are always network-only. If the connection is
  // unavailable, show the non-sensitive offline shell; never fall back to a
  // previously cached patient or billing page.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL)),
    );
    return;
  }

  const isStaticAsset =
    url.pathname.startsWith("/_next/static/") ||
    [
      "/apple-touch-icon.png",
      "/icon-192.png",
      "/icon-512.png",
      "/login-pattern.svg",
      "/logo.png",
      "/logo-mark.png",
      "/favicon.ico",
      "/manifest.webmanifest",
    ].includes(url.pathname);

  // Let the browser fetch all dynamic GETs directly. In particular this keeps
  // /api, report downloads and Next's private RSC payloads out of CacheStorage.
  if (!isStaticAsset) return;

  // Immutable build assets and public branding use stale-while-revalidate.
  event.respondWith(
    caches.open(ASSET_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => undefined);
      return cached ?? (await network) ?? Response.error();
    }),
  );
});
