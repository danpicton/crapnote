/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// SvelteKit-managed service worker. Uses the $service-worker module to get
// the full build manifest (entry, chunks, route nodes, static files) so every
// route works offline once the SW has installed — not just the home route.
//
// Bumping the SvelteKit `version` (or any code change that produces a new
// build hash) automatically invalidates the cache via the version-keyed name.
//
// Strategy summary:
//   - Navigations: cached shell served instantly, revalidated in the
//     background. The app boots at the same speed online and offline.
//   - /api/images/*: cache-first (image blobs are immutable per id).
//   - All other /api/*: network only, NEVER served from cache. Stale API
//     JSON served on network failure used to make the app believe it was
//     online and fully synced while in airplane mode. Offline data lives in
//     IndexedDB (see offlineDB.ts); the SW's only job for the API is to turn
//     a network failure into a recognisable 503 carrying the
//     `X-Crapnote-Offline: 1` marker header, which the API client converts
//     into an OfflineError.

import { build, files, version, prerendered } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_NAME = `crapnote-${version}`;

/** Marker header the API client uses to distinguish "you are offline" from a
 * genuine server-side 503. Keep in sync with frontend/src/lib/api.ts. */
const OFFLINE_HEADER = 'X-Crapnote-Offline';

// Assets that come bundled with the build — safe to cache aggressively.
const PRECACHE = [
	...build,         // hashed JS/CSS chunks under /_app/immutable/
	...files,         // anything in /static (manifest.json, favicon, etc.)
	...prerendered,   // any prerendered HTML routes (none today, but future-safe)
];

// ─── Install: precache the build manifest + the app shell ────────────────────
sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE_NAME);

			// Pre-cache every immutable build asset. Using addAll so a single
			// failure aborts the install — better to leave the previous SW in
			// charge than to ship a half-populated cache.
			await cache.addAll(PRECACHE);

			// Also prime the app shell HTML so navigations work offline. We
			// fetch '/' here because adapter-static emits a single fallback
			// index.html at the root and every SvelteKit route boots from it.
			try {
				const shellRes = await fetch('/', { cache: 'reload' });
				if (shellRes.ok) await cache.put('/', shellRes.clone());
				const loginRes = await fetch('/login', { cache: 'reload' });
				if (loginRes.ok) await cache.put('/login', loginRes.clone());
			} catch {
				// Offline during install — fall back to cache-first behaviour
				// on the next online visit.
			}

			await sw.skipWaiting();
		})(),
	);
});

// ─── Activate: purge old caches, claim all open pages ────────────────────────
sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
			await sw.clients.claim();
		})(),
	);
});

// ─── Fetch routing ───────────────────────────────────────────────────────────
sw.addEventListener('fetch', (event) => {
	const { request } = event;
	const url = new URL(request.url);

	// Only handle same-origin requests; let everything else pass through.
	if (url.origin !== sw.location.origin) return;

	if (url.pathname.startsWith('/api/')) {
		// Image blobs are immutable per id — cache-first so note images keep
		// rendering offline and don't refetch on every list render.
		if (request.method === 'GET' && url.pathname.startsWith('/api/images/')) {
			event.respondWith(cacheFirst(request));
			return;
		}
		// Everything else on the API: network only, reads and writes alike.
		// No SW-level cache or queue — the frontend owns offline note state in
		// IndexedDB, and serving stale JSON here made the app misreport
		// "synced" while offline.
		event.respondWith(networkOnly(request));
		return;
	}

	// Top-level HTML loads (link clicks, cold PWA start, address bar).
	// Serve the shell cached at install time: it references exactly the
	// hashed chunks precached in the same install, so shell and chunks stay
	// consistent by construction and offline starts are instant. New deploys
	// arrive via the browser's SW update check (every build changes
	// `version`, hence the SW script), which installs a fresh cache + shell
	// atomically. Never refresh the cached shell from the network outside
	// that cycle — a newer deploy's shell references chunk hashes this cache
	// doesn't hold, and caching it would break cold offline starts until the
	// new SW finishes installing.
	if (request.mode === 'navigate') {
		event.respondWith(navigationCacheFirst(request));
		return;
	}

	// Hashed bundles under /_app/immutable/* and /static/* — cache-first.
	event.respondWith(cacheFirst(request));
});

// ─── Strategy helpers ────────────────────────────────────────────────────────

async function navigationCacheFirst(request: Request): Promise<Response> {
	// The shell is always keyed under '/' (adapter-static emits one fallback
	// index.html that boots every route), so any navigation can use it.
	const cached = (await caches.match(request)) ?? (await caches.match('/'));
	if (cached) return cached;

	// No cached shell yet — the install-time prime raced this navigation or
	// failed. Serve the network and remember the result so the next
	// navigation is covered.
	try {
		const response = await fetch(request);
		if (response.ok) {
			const cache = await caches.open(CACHE_NAME);
			await cache.put('/', response.clone());
		}
		return response;
	} catch {
		return new Response('Offline', { status: 503 });
	}
}

async function cacheFirst(request: Request): Promise<Response> {
	const cached = await caches.match(request);
	if (cached) return cached;
	try {
		const response = await fetch(request);
		if (response.ok) {
			const cache = await caches.open(CACHE_NAME);
			cache.put(request, response.clone());
		}
		return response;
	} catch {
		return new Response('Offline', { status: 503 });
	}
}

async function networkOnly(request: Request): Promise<Response> {
	try {
		return await fetch(request);
	} catch {
		// No SW-level queueing or cache fallback: surface a marked 503 so the
		// API client throws OfflineError and the caller's own offline handling
		// (IndexedDB cache, dirty-note replay) takes over knowing it is
		// genuinely offline.
		return new Response('{"error":"offline"}', {
			status: 503,
			headers: {
				'Content-Type': 'application/json',
				[OFFLINE_HEADER]: '1',
			},
		});
	}
}
