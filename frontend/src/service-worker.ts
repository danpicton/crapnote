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
	imageCacheFirst,
	cacheFirst,
	networkOnly,
} from '$lib/service-worker-strategies';
import { getOfflineOwner, openOfflineDB } from '$lib/offlineDB';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_NAME = `crapnote-${version}`;

/**
 * Identity proofs are scoped to a particular window client, not held as one
 * global "unlocked" bit. A new tab (or a tab opened after the browser was
 * closed) therefore starts unable to read cached note images. The page sends
 * this only after a live session check or successful local unlock.
 *
 * This map intentionally lives only in service-worker memory. If the worker
 * restarts, clients re-authorise via sw-register's controllerchange handler;
 * failing closed briefly is preferable to persisting an unlock beside the
 * cache it is supposed to protect.
 */
const provedImageClients = new Map<string, number>();
const pendingIdentityRequests = new Map<
	string,
	{ promise: Promise<void>; resolve: () => void }
>();

sw.addEventListener('message', (event) => {
	const data = event.data as { type?: unknown; userId?: unknown } | null;
	if (data?.type !== 'crapnote:image-cache-identity') return;

	const source = event.source;
	if (!source || !('id' in source) || typeof source.id !== 'string') return;
	if (typeof data.userId === 'number' && Number.isSafeInteger(data.userId)) {
		provedImageClients.set(source.id, data.userId);
	} else if (data.userId === null) {
		provedImageClients.delete(source.id);
	} else {
		return;
	}
	// Let the page keep its protected children withheld until the worker has
	// applied the new state, avoiding an unlock-vs-image-fetch race offline.
	event.ports[0]?.postMessage('ok');
	pendingIdentityRequests.get(source.id)?.resolve();
});

/**
 * Service-worker globals may be terminated while their controlled pages stay
 * open. Ask that exact page to resend its in-memory identity when our map was
 * lost; a direct image navigation has no existing client and remains denied.
 */
async function recoverClientIdentity(clientId: string): Promise<void> {
	if (!clientId || provedImageClients.has(clientId)) return;
	const existing = pendingIdentityRequests.get(clientId);
	if (existing) return existing.promise;

	let resolve!: () => void;
	const promise = new Promise<void>((done) => { resolve = done; });
	pendingIdentityRequests.set(clientId, { promise, resolve });
	// A newly activated worker may control a page still running an older bundle
	// with no recovery listener. Bound that compatibility case rather than
	// leaving its fetch pending forever; current clients normally reply at once.
	const timeout = setTimeout(resolve, 5000);
	try {
		const client = await sw.clients.get(clientId);
		client?.postMessage({ type: 'crapnote:request-image-cache-identity' });
		if (!client) resolve();
	} catch {
		resolve();
	}
	await promise;
	clearTimeout(timeout);
	pendingIdentityRequests.delete(clientId);
}

/** Returns the owner id only when this exact page client proved ownership. */
async function clientImageCacheOwner(clientId: string): Promise<number | null> {
	await recoverClientIdentity(clientId);
	const provedUserId = provedImageClients.get(clientId);
	if (provedUserId === undefined) return null;

	let db: IDBDatabase;
	try {
		db = await openOfflineDB();
	} catch {
		return null;
	}
	try {
		return (await getOfflineOwner(db)) === provedUserId ? provedUserId : null;
	} catch {
		return null;
	} finally {
		db.close();
	}
}

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
			await Promise.all(
				keys
					.filter((k) => k !== CACHE_NAME && !k.startsWith(`${CACHE_NAME}-images-`))
					.map((k) => caches.delete(k))
			);
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
		case 'image-cache-first':
			event.respondWith(
				imageCacheFirst(request, CACHE_NAME, () => clientImageCacheOwner(event.clientId))
			);
			return;
		case 'cache-first':
			event.respondWith(cacheFirst(request, CACHE_NAME));
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
