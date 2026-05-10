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

import { build, files, version, prerendered } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_NAME = `crapnote-${version}`;

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

	// Don't try to cache non-GET requests at all (the queueing path is below).
	if (url.pathname.startsWith('/api/')) {
		// Network-first for reads; bare network for writes (no SW-level queue —
		// the frontend manages its own offline cache + dirty-note replay via
		// IndexedDB, and the previous queue produced 202s the API client could
		// not distinguish from a real success, corrupting note state).
		const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);
		event.respondWith(isWrite ? networkOnly(request) : networkFirst(request));
		return;
	}

	// Top-level HTML loads (link clicks, soft refresh, address bar). Network-
	// first so new deploys aren't masked by a stale shell that references
	// `_app/immutable/*` hashes the server no longer has. The cached `/` is
	// only used as the offline fallback.
	if (request.mode === 'navigate') {
		event.respondWith(navigationNetworkFirst(request));
		return;
	}

	// Hashed bundles under /_app/immutable/* and /static/* — cache-first.
	event.respondWith(cacheFirst(request));
});

// ─── Strategy helpers ────────────────────────────────────────────────────────

async function navigationNetworkFirst(request: Request): Promise<Response> {
	try {
		const response = await fetch(request);
		if (response.ok) {
			const cache = await caches.open(CACHE_NAME);
			// Always key the shell under '/' so offline fallback is predictable
			// regardless of which path the user navigated to.
			cache.put('/', response.clone());
		}
		return response;
	} catch {
		const cached = (await caches.match(request)) ?? (await caches.match('/'));
		if (cached) return cached;
		return new Response('Offline', { status: 503 });
	}
}

async function networkFirst(request: Request): Promise<Response> {
	try {
		const response = await fetch(request);
		if (response.ok) {
			const cache = await caches.open(CACHE_NAME);
			cache.put(request, response.clone());
		}
		return response;
	} catch {
		const cached = await caches.match(request);
		return (
			cached ??
			new Response('{"error":"offline"}', {
				status: 503,
				headers: { 'Content-Type': 'application/json' },
			})
		);
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
		if (request.mode === 'navigate') {
			const shell = await caches.match('/');
			if (shell) return shell;
		}
		return new Response('Offline', { status: 503 });
	}
}

async function networkOnly(request: Request): Promise<Response> {
	try {
		return await fetch(request);
	} catch {
		// No SW-level queueing: surface a 503 so the API client throws and the
		// caller's own offline-cache fallback (IndexedDB dirty notes) runs.
		return new Response('{"error":"offline"}', {
			status: 503,
			headers: { 'Content-Type': 'application/json' },
		});
	}
}
