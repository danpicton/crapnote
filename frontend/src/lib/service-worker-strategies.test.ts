import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	OFFLINE_HEADER,
	selectStrategy,
	navigationCacheFirst,
	cacheFirst,
	networkOnly,
	type FetchStrategy,
} from './service-worker-strategies';

const ORIGIN = location.origin;
const CACHE_NAME = 'crapnote-test';

// ─── In-memory Cache Storage shim ────────────────────────────────────────────
// jsdom implements neither `caches` nor a service worker scope, so the tests
// stand up a Map-backed `CacheStorage` with just the surface the strategies
// touch: `caches.match`, `caches.open` and `cache.put`.

type CacheKey = RequestInfo | URL;

/** Normalise the key the way the real Cache API does: relative strings resolve
 * against the page origin, Requests key on their (already absolute) URL. */
function cacheKey(input: CacheKey): string {
	const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
	return new URL(raw, ORIGIN).href;
}

class FakeCache {
	readonly store = new Map<string, Response>();

	async match(input: CacheKey): Promise<Response | undefined> {
		const hit = this.store.get(cacheKey(input));
		// The real Cache hands out a fresh Response each time, so bodies stay
		// readable across repeated matches.
		return hit ? hit.clone() : undefined;
	}

	async put(input: CacheKey, response: Response): Promise<void> {
		this.store.set(cacheKey(input), response);
	}
}

class FakeCacheStorage {
	readonly opened = new Map<string, FakeCache>();

	async open(name: string): Promise<FakeCache> {
		let cache = this.opened.get(name);
		if (!cache) {
			cache = new FakeCache();
			this.opened.set(name, cache);
		}
		return cache;
	}

	async match(input: CacheKey): Promise<Response | undefined> {
		for (const cache of this.opened.values()) {
			const hit = await cache.match(input);
			if (hit) return hit;
		}
		return undefined;
	}
}

let cacheStorage: FakeCacheStorage;
let mockFetch: ReturnType<typeof vi.fn>;

/** Seed the version-keyed cache the strategies write to. */
async function seed(key: CacheKey, response: Response): Promise<void> {
	const cache = await cacheStorage.open(CACHE_NAME);
	await cache.put(key, response);
}

/** Keys currently held in the version-keyed cache. */
function cachedKeys(): string[] {
	return [...(cacheStorage.opened.get(CACHE_NAME)?.store.keys() ?? [])];
}

/**
 * The real `Request` constructor rejects `mode: 'navigate'` (the spec reserves
 * it for browser-initiated top-level loads), so requests here are minimal
 * stand-ins carrying the only three fields the strategies read.
 */
function req(path: string, init: { method?: string; mode?: RequestMode } = {}): Request {
	return {
		url: new URL(path, ORIGIN).href,
		method: init.method ?? 'GET',
		mode: init.mode ?? 'cors',
	} as unknown as Request;
}

beforeEach(() => {
	cacheStorage = new FakeCacheStorage();
	mockFetch = vi.fn();
	vi.stubGlobal('caches', cacheStorage);
	vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

// ─── networkOnly ─────────────────────────────────────────────────────────────

describe('networkOnly', () => {
	it('returns the network response untouched on success', async () => {
		const network = new Response('{"id":1}', { status: 200, headers: { 'X-Server': 'yes' } });
		mockFetch.mockResolvedValueOnce(network);

		const res = await networkOnly(req('/api/notes/1'));

		expect(res).toBe(network);
		expect(res.status).toBe(200);
		expect(res.headers.get('X-Server')).toBe('yes');
		expect(res.headers.get(OFFLINE_HEADER)).toBeNull();
	});

	it('passes non-ok server responses straight through without marking them offline', async () => {
		mockFetch.mockResolvedValueOnce(new Response('boom', { status: 503 }));

		const res = await networkOnly(req('/api/notes'));

		// A genuine server-side 503 must NOT carry the offline marker, or the
		// API client would misreport it as an OfflineError.
		expect(res.status).toBe(503);
		expect(res.headers.get(OFFLINE_HEADER)).toBeNull();
	});

	it('synthesises a marked 503 when fetch rejects', async () => {
		mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

		const res = await networkOnly(req('/api/notes'));

		// All three parts of the contract api.ts reads (see OfflineError).
		expect(res.status).toBe(503);
		expect(res.headers.get(OFFLINE_HEADER)).toBe('1');
		expect(await res.json()).toEqual({ error: 'offline' });
		expect(res.headers.get('Content-Type')).toBe('application/json');
	});

	it('marks the synthetic 503 with the exact literal api.ts looks for', async () => {
		mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

		const res = await networkOnly(req('/api/notes'));

		// Pinned as a literal, deliberately not via OFFLINE_HEADER: api.ts
		// declares its own independent copy of this string, so the two halves
		// can only be held together by asserting the wire value. Renaming the
		// header would otherwise leave this suite green while every offline
		// call surfaced as a generic 503 — no OfflineError, so the IndexedDB
		// fallback and dirty-note replay would never engage.
		expect(res.headers.get('X-Crapnote-Offline')).toBe('1');
		expect(OFFLINE_HEADER).toBe('X-Crapnote-Offline');
	});

	it('never consults the cache on success', async () => {
		const matchSpy = vi.spyOn(cacheStorage, 'match');
		await seed(req('/api/notes'), new Response('stale', { status: 200 }));
		mockFetch.mockResolvedValueOnce(new Response('fresh', { status: 200 }));

		const res = await networkOnly(req('/api/notes'));

		expect(await res.text()).toBe('fresh');
		expect(matchSpy).not.toHaveBeenCalled();
	});

	it('never falls back to the cache when the network fails', async () => {
		const matchSpy = vi.spyOn(cacheStorage, 'match');
		await seed(req('/api/notes'), new Response('stale', { status: 200 }));
		mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

		const res = await networkOnly(req('/api/notes'));

		// Serving stale JSON here is what used to make the app believe it was
		// online and synced while in airplane mode.
		expect(res.status).toBe(503);
		expect(await res.text()).toBe('{"error":"offline"}');
		expect(matchSpy).not.toHaveBeenCalled();
	});
});

// ─── navigationCacheFirst ────────────────────────────────────────────────────

describe('navigationCacheFirst', () => {
	it('does NOT hit the network on a cache hit', async () => {
		await seed('/', new Response('<cached-shell/>', { status: 200 }));
		const request = req('/', { mode: 'navigate' });

		const res = await navigationCacheFirst(request, CACHE_NAME);

		expect(await res.text()).toBe('<cached-shell/>');
		// Load-bearing: revalidating outside the SW install cycle would cache a
		// newer deploy's shell whose chunk hashes this cache doesn't hold,
		// breaking cold offline starts.
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("falls back to the '/' shell for a route that is not itself cached", async () => {
		await seed('/', new Response('<cached-shell/>', { status: 200 }));
		const request = req('/notes/42', { mode: 'navigate' });

		const res = await navigationCacheFirst(request, CACHE_NAME);

		expect(await res.text()).toBe('<cached-shell/>');
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('prefers an exactly-cached route over the shell fallback', async () => {
		await seed('/', new Response('<cached-shell/>', { status: 200 }));
		await seed('/login', new Response('<login-shell/>', { status: 200 }));

		const res = await navigationCacheFirst(req('/login', { mode: 'navigate' }), CACHE_NAME);

		expect(await res.text()).toBe('<login-shell/>');
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("caches a network shell under '/' rather than the request URL on a total miss", async () => {
		mockFetch.mockResolvedValueOnce(new Response('<fresh-shell/>', { status: 200 }));
		const request = req('/notes/42', { mode: 'navigate' });

		const res = await navigationCacheFirst(request, CACHE_NAME);

		expect(await res.text()).toBe('<fresh-shell/>');
		expect(mockFetch).toHaveBeenCalledWith(request);
		expect(cachedKeys()).toEqual([`${ORIGIN}/`]);
		expect(cachedKeys()).not.toContain(`${ORIGIN}/notes/42`);
	});

	it('does not cache a non-ok network response', async () => {
		mockFetch.mockResolvedValueOnce(new Response('nope', { status: 500 }));

		const res = await navigationCacheFirst(req('/notes/42', { mode: 'navigate' }), CACHE_NAME);

		expect(res.status).toBe(500);
		expect(cachedKeys()).toEqual([]);
	});

	it('returns a bare 503 when the network fails with nothing cached', async () => {
		mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

		const res = await navigationCacheFirst(req('/notes/42', { mode: 'navigate' }), CACHE_NAME);

		expect(res.status).toBe(503);
		expect(await res.text()).toBe('Offline');
		// Navigations are not API calls, so no OfflineError marker here.
		expect(res.headers.get(OFFLINE_HEADER)).toBeNull();
	});
});

// ─── cacheFirst ──────────────────────────────────────────────────────────────

describe('cacheFirst', () => {
	it('returns the cached response without touching the network', async () => {
		const request = req('/api/images/7');
		await seed(request, new Response('cached-bytes', { status: 200 }));

		const res = await cacheFirst(request, CACHE_NAME);

		expect(await res.text()).toBe('cached-bytes');
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('fetches and caches an ok response under the request URL on a miss', async () => {
		const request = req('/_app/immutable/chunk.abc123.js');
		mockFetch.mockResolvedValueOnce(new Response('export {}', { status: 200 }));

		const res = await cacheFirst(request, CACHE_NAME);

		expect(await res.text()).toBe('export {}');
		expect(mockFetch).toHaveBeenCalledWith(request);
		expect(cachedKeys()).toEqual([`${ORIGIN}/_app/immutable/chunk.abc123.js`]);
	});

	it('does NOT cache a non-ok response', async () => {
		const request = req('/api/images/404');
		mockFetch.mockResolvedValueOnce(new Response('not found', { status: 404 }));

		const res = await cacheFirst(request, CACHE_NAME);

		// The 404 is still returned, but poisoning the cache with it would make
		// the miss permanent for the life of this build's cache.
		expect(res.status).toBe(404);
		expect(cachedKeys()).toEqual([]);
	});

	it('returns a bare 503 when the network fails and nothing is cached', async () => {
		mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

		const res = await cacheFirst(req('/favicon.png'), CACHE_NAME);

		expect(res.status).toBe(503);
		expect(await res.text()).toBe('Offline');
		expect(cachedKeys()).toEqual([]);
	});
});

// ─── Fetch routing ───────────────────────────────────────────────────────────

describe('selectStrategy', () => {
	const cases: Array<[string, FetchStrategy, Request]> = [
		// Cross-origin: the SW must not respondWith at all.
		['cross-origin asset', 'passthrough', req('https://cdn.example.com/analytics.js')],
		['cross-origin API', 'passthrough', req('https://api.example.com/api/notes')],
		['cross-origin navigation', 'passthrough', req('https://example.com/', { mode: 'navigate' })],

		// Images are immutable per id.
		['GET /api/images/<id>', 'cache-first', req('/api/images/7')],
		['GET /api/images/<id> with query', 'cache-first', req('/api/images/7?w=200')],

		// Every other API call, read or write.
		['GET /api/notes', 'network-only', req('/api/notes')],
		['POST /api/notes', 'network-only', req('/api/notes', { method: 'POST' })],
		['PATCH /api/notes/1', 'network-only', req('/api/notes/1', { method: 'PATCH' })],
		['DELETE /api/notes/1', 'network-only', req('/api/notes/1', { method: 'DELETE' })],
		['GET /api/auth/me', 'network-only', req('/api/auth/me')],
		// Non-GET on the images route is an upload, not a read — network only.
		// The collection path is caught by the path check alone; the /<id> case
		// below is the one that actually exercises the GET guard.
		['POST /api/images', 'network-only', req('/api/images', { method: 'POST' })],
		['DELETE /api/images/7', 'network-only', req('/api/images/7', { method: 'DELETE' })],
		['POST /api/images/7', 'network-only', req('/api/images/7', { method: 'POST' })],

		// Top-level HTML loads.
		['navigation to /', 'navigation-cache-first', req('/', { mode: 'navigate' })],
		['navigation to a deep route', 'navigation-cache-first', req('/notes/42', { mode: 'navigate' })],

		// Everything else same-origin.
		['hashed bundle', 'cache-first', req('/_app/immutable/chunk.abc123.js')],
		['static file', 'cache-first', req('/manifest.json')],
	];

	it.each(cases)('routes %s to %s', (_label, expected, request) => {
		expect(selectStrategy(request, ORIGIN)).toBe(expected);
	});

	it('checks origin before anything else', () => {
		// A cross-origin /api/ path must pass through rather than be treated as
		// this app's API.
		expect(selectStrategy(req('https://elsewhere.test/api/images/1'), ORIGIN)).toBe('passthrough');
	});
});
