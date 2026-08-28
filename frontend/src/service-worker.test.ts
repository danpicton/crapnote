// Importing src/service-worker.ts pulls in its `no-default-lib="true"` +
// `lib="webworker"` triple-slash directives, which drop the DOM libs from the
// whole svelte-check program. Re-assert them here so unrelated DOM-typed files
// keep type-checking; removing these two lines breaks `npm run check`.
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cacheFirst, navigationCacheFirst, networkOnly } from '$lib/service-worker-strategies';

// The strategies themselves are covered in service-worker-strategies.test.ts.
// What is untestable from there — and what these tests pin — is the wiring in
// the SW's fetch listener: that each strategy *name* reaches the matching
// strategy *function*, and that a passthrough never calls respondWith at all.
// Swapping two cases in that switch is invisible to the strategy unit tests.
vi.mock('$lib/service-worker-strategies', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/service-worker-strategies')>();
	return {
		...actual,
		// selectStrategy stays real: the routing table is tested for real, only
		// the strategy implementations are stood in for so the call is visible.
		navigationCacheFirst: vi.fn(async () => new Response('nav')),
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
		respondWith: (response: Promise<Response>) => {
			responded = response;
		},
	});
	window.dispatchEvent(event);
	return responded;
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
	vi.mocked(cacheFirst).mockClear();
	vi.mocked(networkOnly).mockClear();
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
		expect(cacheFirst).not.toHaveBeenCalled();
		expect(navigationCacheFirst).not.toHaveBeenCalled();
	});
});
