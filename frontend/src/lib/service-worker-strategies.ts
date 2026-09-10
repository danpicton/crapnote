// Fetch strategies and routing for the service worker (src/service-worker.ts).
//
// These live outside service-worker.ts purely so they can be unit-tested: the
// SW module imports the `$service-worker` build manifest, which only resolves
// inside a SvelteKit build. The strategies need nothing but `caches`, `fetch`
// and a cache name, so they are plain functions here and the SW module glues
// them to its `fetch` event listener.
//
// Strategy summary:
//   - Navigations: cache-first on the app shell, deliberately without
//     background revalidation (see navigationCacheFirst).
//   - /api/images/*: cache-first only for a client whose identity has been
//     proved and matches the offline-store owner; otherwise network-only.
//   - All other /api/*: network only, NEVER served from cache. Stale API
//     JSON served on network failure used to make the app believe it was
//     online and fully synced while in airplane mode. Offline data lives in
//     IndexedDB (see offlineDB.ts); the SW's only job for the API is to turn
//     a network failure into a recognisable 503 carrying the
//     `X-Crapnote-Offline: 1` marker header, which the API client converts
//     into an OfflineError.

/** Marker header the API client uses to distinguish "you are offline" from a
 * genuine server-side 503. frontend/src/lib/api.ts declares its own
 * independent `OFFLINE_HEADER` with the same literal; the two must stay
 * identical, so the tests pin the literal string rather than this constant. */
export const OFFLINE_HEADER = 'X-Crapnote-Offline';

/**
 * Which strategy the SW's fetch listener should apply to a request.
 * `passthrough` means "do not call respondWith at all" — let the browser
 * handle it as if no service worker were installed.
 */
export type FetchStrategy =
	| 'passthrough'
	| 'navigation-cache-first'
	| 'image-cache-first'
	| 'cache-first'
	| 'network-only';

/**
 * The SW's fetch routing decision, as a pure function of the request and the
 * SW's own origin.
 */
export function selectStrategy(request: Request, swOrigin: string): FetchStrategy {
	const url = new URL(request.url);

	// Only handle same-origin requests; let everything else pass through.
	if (url.origin !== swOrigin) return 'passthrough';

	if (url.pathname.startsWith('/api/')) {
		// Image blobs are immutable per id — cache-first so note images keep
		// rendering offline and don't refetch on every list render.
		if (request.method === 'GET' && url.pathname.startsWith('/api/images/')) {
			return 'image-cache-first';
		}
		// Everything else on the API: network only, reads and writes alike.
		// No SW-level cache or queue — the frontend owns offline note state in
		// IndexedDB, and serving stale JSON here made the app misreport
		// "synced" while offline.
		return 'network-only';
	}

	// Top-level HTML loads (link clicks, cold PWA start, address bar).
	if (request.mode === 'navigate') return 'navigation-cache-first';

	// Hashed bundles under /_app/immutable/* and /static/* — cache-first.
	return 'cache-first';
}

/**
 * Serve the shell cached at install time: it references exactly the hashed
 * chunks precached in the same install, so shell and chunks stay consistent by
 * construction and offline starts are instant. New deploys arrive via the
 * browser's SW update check (every build changes `version`, hence the SW
 * script), which installs a fresh cache + shell atomically. Never refresh the
 * cached shell from the network outside that cycle — a newer deploy's shell
 * references chunk hashes this cache doesn't hold, and caching it would break
 * cold offline starts until the new SW finishes installing.
 */
export async function navigationCacheFirst(request: Request, cacheName: string): Promise<Response> {
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
			const cache = await caches.open(cacheName);
			await cache.put('/', response.clone());
		}
		return response;
	} catch {
		return new Response('Offline', { status: 503 });
	}
}

export async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
	const cached = await caches.match(request);
	if (cached) return cached;
	try {
		const response = await fetch(request);
		if (response.ok) {
			const cache = await caches.open(cacheName);
			cache.put(request, response.clone());
		}
		return response;
	} catch {
		return new Response('Offline', { status: 503 });
	}
}

/**
 * Cache-first for a note image only after the requesting page has proved its
 * identity and that identity matches the owner stamped on the offline store.
 *
 * When the gate is shut we deliberately go to the network instead of
 * returning a synthetic denial immediately. An online request still receives
 * the backend's normal session/ownership decision, while an offline direct
 * URL cannot fall back to the previous user's cached bytes.
 */
export async function imageCacheFirst(
	request: Request,
	cacheName: string,
	cacheOwner: () => Promise<number | null>
): Promise<Response> {
	let owner: number | null = null;
	try {
		owner = await cacheOwner();
	} catch {
		// An unreadable owner record or unavailable IDB is uncertainty, and the
		// local cache gate always fails closed on uncertainty.
	}
	// `no-store` matters here: the backend marks images private+immutable, so a
	// plain fetch may be satisfied by the browser's HTTP cache and bypass the
	// gate just as surely as Cache Storage did.
	if (owner === null) return networkOnly(request, true);

	// Cache entries are partitioned by owner. Besides making the ownership
	// relationship explicit, this closes races where an old owner's in-flight
	// response completes after logout/account-switch cleanup and repopulates a
	// shared cache. A later user never consults that old owner's partition.
	let cache: Cache | null = null;
	try {
		cache = await caches.open(`${cacheName}-images-${owner}`);
		const cached = await cache.match(request);
		if (cached) return cached;
	} catch {
		// Cache Storage is an optimisation. If it is unavailable, retain the
		// backend's normal online behaviour rather than rejecting the request.
	}
	try {
		const response = await fetch(request, { cache: 'no-store' });
		if (response.ok) {
			// The cookie can change in another tab between the local owner check
			// and this fetch. Only accept/cache bytes when the backend confirms
			// that its authenticated owner is the same identity that opened this
			// partition; otherwise even the one in-flight response fails closed.
			if (response.headers.get('X-Crapnote-Image-Owner') !== String(owner)) {
				return new Response('Image owner changed', { status: 403 });
			}
			try {
				await cache?.put(request, response.clone());
			} catch {
				// Quota/eviction failures must not replace valid online bytes with
				// an "Offline" response. This image simply will not work offline.
			}
		}
		return response;
	} catch {
		return new Response('Offline', { status: 503 });
	}
}

export async function networkOnly(request: Request, bypassHttpCache = false): Promise<Response> {
	try {
		return bypassHttpCache
			? await fetch(request, { cache: 'no-store' })
			: await fetch(request);
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
