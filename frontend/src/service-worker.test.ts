// Importing src/service-worker.ts pulls in its `no-default-lib="true"` +
// `lib="webworker"` triple-slash directives, which drop the DOM libs from the
// whole svelte-check program. Re-assert them here so unrelated DOM-typed files
// keep type-checking; removing these two lines breaks `npm run check`.
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	cacheFirst,
	imageCacheFirst,
	navigationCacheFirst,
	networkOnly,
} from '$lib/service-worker-strategies';
import { openOfflineDB, setOfflineOwner } from '$lib/offlineDB';

// The strategies themselves are covered in service-worker-strategies.test.ts.
// What is untestable from there — and what these tests pin — is the wiring in
// the SW's fetch listener: that each strategy *name* reaches the matching
// strategy *function*, and that a passthrough never calls respondWith at all.
// Swapping two cases in that switch is invisible to the strategy unit tests.
const mockClientGet = vi.fn().mockResolvedValue(undefined);
Object.defineProperty(window, 'clients', {
	configurable: true,
	value: { get: mockClientGet },
});

vi.mock('$lib/service-worker-strategies', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/service-worker-strategies')>();
	return {
		...actual,
		// selectStrategy stays real: the routing table is tested for real, only
		// the strategy implementations are stood in for so the call is visible.
		navigationCacheFirst: vi.fn(async () => new Response('nav')),
		imageCacheFirst: vi.fn(async () => new Response('image')),
		cacheFirst: vi.fn(async () => new Response('cache')),
		networkOnly: vi.fn(async () => new Response('net')),
	};
});

// `$service-worker` is aliased to a stub manifest in vitest.config.ts; the SW
// module registers its listeners on import.
await import('./service-worker');

/** Dispatch a fetch event the way the browser would, returning whatever the
 * listener passed to respondWith (undefined for a passthrough). */
function dispatchFetch(request: Request): Promise<Response> | undefined {
	let responded: Promise<Response> | undefined;
	const event = Object.assign(new Event('fetch'), {
		request,
		clientId: 'test-client',
		respondWith: (response: Promise<Response>) => {
			responded = response;
		},
	});
	window.dispatchEvent(event);
	return responded;
}

function dispatchImageIdentity(userId: number | null, clientId = 'test-client'): void {
	const event = Object.assign(new Event('message'), {
		data: { type: 'crapnote:image-cache-identity', userId },
		source: { id: clientId },
		ports: [{ postMessage: vi.fn() }],
	});
	window.dispatchEvent(event);
}

function req(path: string, init: { method?: string; mode?: RequestMode } = {}): Request {
	return {
		url: new URL(path, location.origin).href,
		method: init.method ?? 'GET',
		mode: init.mode ?? 'cors',
	} as unknown as Request;
}

beforeEach(() => {
	vi.mocked(navigationCacheFirst).mockClear();
	vi.mocked(imageCacheFirst).mockClear();
	vi.mocked(cacheFirst).mockClear();
	vi.mocked(networkOnly).mockClear();
	mockClientGet.mockReset().mockResolvedValue(undefined);
	dispatchImageIdentity(null);
});

describe('service worker fetch listener', () => {
	it('answers an API request with networkOnly', async () => {
		const request = req('/api/notes');

		const responded = dispatchFetch(request);

		expect(await responded?.then((r) => r.text())).toBe('net');
		expect(networkOnly).toHaveBeenCalledWith(request);
		expect(cacheFirst).not.toHaveBeenCalled();
		expect(navigationCacheFirst).not.toHaveBeenCalled();
	});

	it('gates an image request through imageCacheFirst', async () => {
		const request = req('/api/images/7');

		const responded = dispatchFetch(request);

		expect(await responded?.then((r) => r.text())).toBe('image');
		expect(imageCacheFirst).toHaveBeenCalledWith(request, 'crapnote-test', expect.any(Function));
		expect(cacheFirst).not.toHaveBeenCalled();
		expect(networkOnly).not.toHaveBeenCalled();
	});

	it('opens the image gate only for a proved client matching the store owner', async () => {
		const db = await openOfflineDB();
		await setOfflineOwner(db, 7);
		db.close();

		dispatchImageIdentity(7);
		dispatchFetch(req('/api/images/7'));
		const matchingOwner = vi.mocked(imageCacheFirst).mock.calls[0][2];
		expect(await matchingOwner()).toBe(7);

		vi.mocked(imageCacheFirst).mockClear();
		dispatchImageIdentity(8);
		dispatchFetch(req('/api/images/7'));
		const differentOwner = vi.mocked(imageCacheFirst).mock.calls[0][2];
		expect(await differentOwner()).toBeNull();
	});

	it('keeps a fresh or explicitly revoked client out of the image cache', async () => {
		dispatchFetch(req('/api/images/7'));
		const revokedClient = vi.mocked(imageCacheFirst).mock.calls[0][2];
		expect(await revokedClient()).toBeNull();
	});

	it('recovers identity after the service-worker global restarts', async () => {
		const db = await openOfflineDB();
		await setOfflineOwner(db, 7);
		db.close();
		mockClientGet.mockResolvedValue({
			postMessage: (message: { type?: string }) => {
				if (message.type === 'crapnote:request-image-cache-identity') {
					dispatchImageIdentity(7);
				}
			},
		});

		dispatchFetch(req('/api/images/7'));
		const recoveredClient = vi.mocked(imageCacheFirst).mock.calls[0][2];

		expect(await recoveredClient()).toBe(7);
		expect(mockClientGet).toHaveBeenCalledWith('test-client');
	});

	it('answers a navigation with navigationCacheFirst, passing the cache name', async () => {
		const request = req('/notes/42', { mode: 'navigate' });

		const responded = dispatchFetch(request);

		expect(await responded?.then((r) => r.text())).toBe('nav');
		expect(navigationCacheFirst).toHaveBeenCalledWith(request, 'crapnote-test');
		expect(networkOnly).not.toHaveBeenCalled();
		expect(cacheFirst).not.toHaveBeenCalled();
	});

	it('answers a hashed asset with cacheFirst, passing the cache name', async () => {
		const request = req('/_app/immutable/chunk.abc123.js');

		const responded = dispatchFetch(request);

		expect(await responded?.then((r) => r.text())).toBe('cache');
		expect(cacheFirst).toHaveBeenCalledWith(request, 'crapnote-test');
		expect(networkOnly).not.toHaveBeenCalled();
		expect(navigationCacheFirst).not.toHaveBeenCalled();
	});

	it('leaves a cross-origin request entirely alone', () => {
		const responded = dispatchFetch(req('https://cdn.example.com/analytics.js'));

		// No respondWith at all — the browser handles it as if no SW existed.
		expect(responded).toBeUndefined();
		expect(networkOnly).not.toHaveBeenCalled();
		expect(imageCacheFirst).not.toHaveBeenCalled();
		expect(cacheFirst).not.toHaveBeenCalled();
		expect(navigationCacheFirst).not.toHaveBeenCalled();
	});
});
