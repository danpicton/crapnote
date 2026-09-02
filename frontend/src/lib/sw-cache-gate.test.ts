import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	CACHE_GATE_QUERY,
	CACHE_GATE_STATE,
	createCacheGate,
	type CacheGate,
	reportCacheGate,
	answerCacheGateQueries,
} from './sw-cache-gate';

// ─── Service-worker side ─────────────────────────────────────────────────────

describe('createCacheGate (service-worker side)', () => {
	/**
	 * A gate whose window clients reply as listed: `true`/`false`, or `null`
	 * for a client that is asked and never answers. Replies land in order, a
	 * tick after the query.
	 */
	function gateWithClients(replies: Array<boolean | null>, timeoutMs = 50) {
		const ask = vi.fn(async () => {
			for (const reply of replies) {
				if (reply !== null) queueMicrotask(() => gate.report(reply));
			}
			return replies.length;
		});
		const gate: CacheGate = createCacheGate(ask, { timeoutMs });
		return { gate, ask };
	}

	it('is shut when there is no client to ask', async () => {
		// Fail closed: a service worker with no app page behind it has no idea
		// who is at the keyboard, and the cache it guards outlives the session.
		const { gate } = gateWithClients([]);

		expect(await gate.isOpen()).toBe(false);
	});

	it('is shut when the client it asked never answers', async () => {
		const { gate } = gateWithClients([null]);

		expect(await gate.isOpen()).toBe(false);
	});

	it('opens when a client answers that the session may read the cache', async () => {
		const { gate } = gateWithClients([true]);

		expect(await gate.isOpen()).toBe(true);
	});

	it('stays shut when a client answers that the session is locked', async () => {
		const { gate } = gateWithClients([false]);

		expect(await gate.isOpen()).toBe(false);
	});

	it('lets an unlocked tab vouch even when a locked one answers first', async () => {
		// The unlock proof lives in per-tab sessionStorage, so a second tab
		// opened offline is genuinely locked and answers false. Taking the
		// first answer would fail the owner's own unlocked tab closed, at
		// random, and render 503s for images it is entitled to.
		const { gate } = gateWithClients([false, true]);

		expect(await gate.isOpen()).toBe(true);
	});

	it('fails closed as soon as every client asked has refused', async () => {
		const { gate } = gateWithClients([false, false], 10_000);

		const started = Date.now();
		expect(await gate.isOpen()).toBe(false);

		// Unanimity, not the deadline: a locked browser must not wait out the
		// full timeout before every image gives up.
		expect(Date.now() - started).toBeLessThan(1_000);
	});

	it('does not wait out the deadline when there is nobody to ask', async () => {
		const { gate } = gateWithClients([], 10_000);

		const started = Date.now();
		expect(await gate.isOpen()).toBe(false);

		expect(Date.now() - started).toBeLessThan(1_000);
	});

	it('asks the clients for every decision', async () => {
		const { gate, ask } = gateWithClients([true]);

		await gate.isOpen();
		await gate.isOpen();

		// Nothing is remembered between requests — see the next test for why.
		expect(ask).toHaveBeenCalledTimes(2);
	});

	it('never reuses an earlier answer once no client is left to give one', async () => {
		const replies: Array<boolean | null> = [true];
		const { gate } = gateWithClients(replies);

		expect(await gate.isOpen()).toBe(true);

		// A closes the tab but leaves the browser running, so the SW outlives
		// its last window. Whoever types a known image URL in next never boots
		// the app, so nothing can report the gate shut — a remembered `true`
		// would hand them A's image (#108 all over again).
		replies.length = 0;
		expect(await gate.isOpen()).toBe(false);
	});

	it('does not pin a synchronous answer for later requests', async () => {
		let aPageIsListening = true;
		// A client that answers during askClients() rather than a tick later.
		// The promise for a query must be published before the query goes
		// out, or clearing it on settle is undone by the assignment that
		// follows — pinning the answer for good, which is the remembered
		// `open` this whole file exists to prevent.
		const gate: CacheGate = createCacheGate(
			async () => {
				if (!aPageIsListening) return 0;
				gate.report(true);
				return 1;
			},
			{ timeoutMs: 20 }
		);

		expect(await gate.isOpen()).toBe(true);

		aPageIsListening = false;
		expect(await gate.isOpen()).toBe(false);
	});

	it('lets a settled query’s deadline expire without disturbing the next one', async () => {
		const replyDelays: number[] = [];
		const gate: CacheGate = createCacheGate(
			async () => {
				const delay = replyDelays.shift() ?? 0;
				if (delay === 0) gate.report(true);
				else setTimeout(() => gate.report(true), delay);
				return 1;
			},
			{ timeoutMs: 50 }
		);

		// First query answers immediately; its 50ms deadline must be cancelled
		// with it. Left running, that stale timer would fire mid-way through
		// the second query and tear down ITS state, dropping the answer below
		// and failing the owner closed.
		replyDelays.push(0, 30);
		expect(await gate.isOpen()).toBe(true);
		await new Promise((r) => setTimeout(r, 40));

		expect(await gate.isOpen()).toBe(true);
	});

	it('shares one query between decisions made at the same time', async () => {
		const { gate, ask } = gateWithClients([true]);

		// A note render asks for several images at once; one round-trip
		// answers them all.
		const answers = await Promise.all([gate.isOpen(), gate.isOpen(), gate.isOpen()]);

		expect(answers).toEqual([true, true, true]);
		expect(ask).toHaveBeenCalledTimes(1);
	});

	it('ignores a report that answers nothing', async () => {
		const { gate } = gateWithClients([]);
		gate.report(true);

		expect(await gate.isOpen()).toBe(false);
	});

	it('fails closed when the clients cannot be asked at all', async () => {
		const gate = createCacheGate(() => Promise.reject(new Error('no clients')), {
			timeoutMs: 10_000,
		});

		expect(await gate.isOpen()).toBe(false);
	});
});

// ─── Page side ───────────────────────────────────────────────────────────────

interface FakeSW {
	posted: unknown[];
	listeners: Array<(e: MessageEvent) => void>;
	started: number;
}

function stubServiceWorker(): FakeSW {
	const fake: FakeSW = { posted: [], listeners: [], started: 0 };
	vi.stubGlobal('navigator', {
		serviceWorker: {
			ready: Promise.resolve({ active: { postMessage: (m: unknown) => fake.posted.push(m) } }),
			addEventListener: (_: string, fn: (e: MessageEvent) => void) => fake.listeners.push(fn),
			removeEventListener: (_: string, fn: (e: MessageEvent) => void) => {
				fake.listeners = fake.listeners.filter((l) => l !== fn);
			},
			startMessages: () => {
				fake.started += 1;
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

	it('starts message delivery, which addEventListener alone does not', () => {
		const fake = stubServiceWorker();

		answerCacheGateQueries(() => true);

		// Without startMessages() the spec queues SW→page messages for ever,
		// so the query would never be answered and the owner's images would
		// stay dark after a service-worker restart.
		expect(fake.started).toBe(1);
	});

	it('ignores other service-worker messages', async () => {
		const fake = stubServiceWorker();
		answerCacheGateQueries(() => true);

		for (const l of fake.listeners) l({ data: { type: 'something-else' } } as MessageEvent);
		await Promise.resolve();

		expect(fake.posted).toEqual([]);
	});
});
