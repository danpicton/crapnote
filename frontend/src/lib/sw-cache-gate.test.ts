import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	CACHE_GATE_QUERY,
	CACHE_GATE_STATE,
	createCacheGate,
	reportCacheGate,
	answerCacheGateQueries,
} from './sw-cache-gate';

// ─── Service-worker side ─────────────────────────────────────────────────────

describe('createCacheGate (service-worker side)', () => {
	it('is shut until the page says otherwise', async () => {
		const gate = createCacheGate(() => {}, { timeoutMs: 5 });

		// Fail closed: a service worker that has just started has no idea who
		// is at the keyboard, and the cache it guards outlives the session.
		expect(await gate.isOpen()).toBe(false);
	});

	it('opens once the page reports an unlocked session, without asking again', async () => {
		const ask = vi.fn();
		const gate = createCacheGate(ask, { timeoutMs: 5 });
		gate.report(true);

		expect(await gate.isOpen()).toBe(true);
		expect(ask).not.toHaveBeenCalled();
	});

	it('shuts again when the page reports a locked or signed-out session', async () => {
		const gate = createCacheGate(() => {}, { timeoutMs: 5 });
		gate.report(true);
		gate.report(false);

		expect(await gate.isOpen()).toBe(false);
	});

	it('asks the page when it has no state yet, and uses the answer', async () => {
		const gate = createCacheGate(() => queueMicrotask(() => gate.report(true)), {
			timeoutMs: 1000,
		});

		// A service worker is killed while idle and restarted by the next
		// fetch, losing the reported state; without this the owner's images
		// would break until they reloaded the page.
		expect(await gate.isOpen()).toBe(true);
	});

	it('only asks while the state is unknown', async () => {
		const ask = vi.fn(() => queueMicrotask(() => gate.report(true)));
		const gate = createCacheGate(ask, { timeoutMs: 1000 });

		await gate.isOpen();
		await gate.isOpen();

		expect(ask).toHaveBeenCalledTimes(1);
	});
});

// ─── Page side ───────────────────────────────────────────────────────────────

interface FakeSW {
	posted: unknown[];
	listeners: Array<(e: MessageEvent) => void>;
}

function stubServiceWorker(): FakeSW {
	const fake: FakeSW = { posted: [], listeners: [] };
	vi.stubGlobal('navigator', {
		serviceWorker: {
			ready: Promise.resolve({ active: { postMessage: (m: unknown) => fake.posted.push(m) } }),
			addEventListener: (_: string, fn: (e: MessageEvent) => void) => fake.listeners.push(fn),
			removeEventListener: (_: string, fn: (e: MessageEvent) => void) => {
				fake.listeners = fake.listeners.filter((l) => l !== fn);
			},
		},
	});
	return fake;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('reportCacheGate (page side)', () => {
	it('posts the gate state to the active service worker', async () => {
		const fake = stubServiceWorker();

		await reportCacheGate(true);

		expect(fake.posted).toEqual([{ type: CACHE_GATE_STATE, open: true }]);
	});

	it('is a no-op where service workers are unavailable', async () => {
		vi.stubGlobal('navigator', {});

		await expect(reportCacheGate(true)).resolves.toBeUndefined();
	});
});

describe('answerCacheGateQueries (page side)', () => {
	it('replies to a query with the current state', async () => {
		const fake = stubServiceWorker();
		let unlocked = false;
		answerCacheGateQueries(() => unlocked);

		unlocked = true;
		for (const l of fake.listeners) l({ data: { type: CACHE_GATE_QUERY } } as MessageEvent);
		await Promise.resolve();
		await Promise.resolve();

		expect(fake.posted).toEqual([{ type: CACHE_GATE_STATE, open: true }]);
	});

	it('ignores other service-worker messages', async () => {
		const fake = stubServiceWorker();
		answerCacheGateQueries(() => true);

		for (const l of fake.listeners) l({ data: { type: 'something-else' } } as MessageEvent);
		await Promise.resolve();

		expect(fake.posted).toEqual([]);
	});
});
