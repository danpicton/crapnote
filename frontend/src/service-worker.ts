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
// This module owns the SW lifecycle (install/activate) and wires the fetch
// event to the strategies in $lib/service-worker-strategies, which live in
// their own module so they can be unit-tested without the `$service-worker`
// build manifest — see service-worker-strategies.ts for the strategy summary.

import { build, files, version, prerendered } from '$service-worker';
import {
	selectStrategy,
	navigationCacheFirst,
	cacheFirst,
	gatedCacheFirst,
	networkOnly,
} from '$lib/service-worker-strategies';
import { CACHE_GATE_QUERY, CACHE_GATE_STATE, createCacheGate } from '$lib/sw-cache-gate';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_NAME = `crapnote-${version}`;

// Assets that come bundled with the build — safe to cache aggressively.
const PRECACHE = [
	...build,         // hashed JS/CSS chunks under /_app/immutable/
	...files,         // anything in /static (manifest.json, favicon, etc.)
	...prerendered,   // any prerendered HTML routes (none today, but future-safe)
];

// ─── Cache gate ──────────────────────────────────────────────────────────────
// Whether cached note images may be served: the page reports its lock state
// here, and a restarted SW asks for it again. See sw-cache-gate.ts.

const cacheGate = createCacheGate(() => {
	void (async () => {
		const clients = await sw.clients.matchAll({ includeUncontrolled: true, type: 'window' });
		for (const client of clients) client.postMessage({ type: CACHE_GATE_QUERY });
	})();
});

sw.addEventListener('message', (event) => {
	const data = event.data as { type?: string; open?: unknown } | null;
	if (data?.type === CACHE_GATE_STATE) cacheGate.report(data.open === true);
});

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
	const strategy = selectStrategy(request, sw.location.origin);

	switch (strategy) {
		case 'passthrough':
			return;
		case 'network-only':
			event.respondWith(networkOnly(request));
			return;
		case 'navigation-cache-first':
			event.respondWith(navigationCacheFirst(request, CACHE_NAME));
			return;
		case 'cache-first':
			event.respondWith(cacheFirst(request, CACHE_NAME));
			return;
		case 'gated-cache-first':
			event.respondWith(gatedCacheFirst(request, CACHE_NAME, () => cacheGate.isOpen()));
			return;
		default: {
			// Exhaustiveness guard. The listener callback returns void, so
			// without this a new FetchStrategy member type-checks cleanly and
			// silently falls through as a passthrough — breaking offline with
			// no error at build or run time. Adding a member now fails
			// `svelte-check` on this assignment.
			const unhandled: never = strategy;
			throw new Error(`unhandled fetch strategy: ${String(unhandled)}`);
		}
	}
});
