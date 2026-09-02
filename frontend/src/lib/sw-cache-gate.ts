/**
 * The cache gate: how the page tells the service worker whether cached
 * `/api/images/*` bytes may be handed out.
 *
 * The SW caches image blobs cache-first, and that cache is cleared only on a
 * deliberate logout — so on a browser someone walked away from, a direct
 * request for a known image URL used to return the previous user's note image
 * with no session and no unlock (#108). The gate closes that: the SW serves
 * from its cache only while the page says the session is live or the local
 * unlock has been passed (`auth.canReadCache`, the same question every other
 * cached-data reader asks).
 *
 * The SW cannot read the page's module state, sessionStorage or the auth
 * store, so it has to ask: every decision sends a query to the SW's window
 * clients and waits briefly for one to answer with the current state. No
 * answer — no app page running, or none that will vouch — means no cached
 * image.
 *
 * The answer is deliberately NOT remembered between requests. A service
 * worker outlives the tab that reported to it (Chrome keeps it around for
 * roughly 30 seconds of idle, and every request resets that timer), so a
 * remembered `open` would still be there for whoever types a known image URL
 * into the address bar after the owner closes their tab — and such a
 * request boots no app page to correct it, which is the exact leak this file
 * exists to close. Requiring a live page to vouch for every response means
 * the state cannot outlive the session it describes.
 *
 * One accepted limitation: the query goes to every window client, so an
 * unlocked tab vouches for a request made from a locked one. That needs the
 * owner's unlocked session to still be on screen, where their notes are
 * readable anyway — it is not a route to anything the next arrival cannot
 * already see.
 */

/** Page → SW: `{ type, open }`, in reply to a query. */
export const CACHE_GATE_STATE = 'crapnote:cache-gate';
/** SW → page: "may I serve a cached image?". */
export const CACHE_GATE_QUERY = 'crapnote:cache-gate-query';

/**
 * How long the SW waits for a client to answer before failing closed.
 *
 * Generous on purpose: the answer comes off the page's main thread, which can
 * be busy for a while during a cold start, and timing out there would show
 * the owner a broken image. Waiting longer costs nothing in the case it
 * guards against — a request with no app page behind it is going to be
 * refused whenever the timer fires.
 */
const DEFAULT_QUERY_TIMEOUT_MS = 2_000;

export interface CacheGate {
	/** Answer the outstanding query, if there is one. */
	report(open: boolean): void;
	/** Whether cached image bytes may be served right now. */
	isOpen(): Promise<boolean>;
}

/**
 * The SW-side gate. `askClients` is called once per decision (concurrent
 * decisions share the one query) to prompt the SW's window clients for a
 * report; the first answer decides, and nobody answering means shut.
 */
export function createCacheGate(
	askClients: () => void,
	{ timeoutMs = DEFAULT_QUERY_TIMEOUT_MS }: { timeoutMs?: number } = {}
): CacheGate {
	// The query in flight, if any. Nothing is kept once it settles: an answer
	// outliving the page that gave it is precisely the hole being closed.
	let asked: Promise<boolean> | null = null;
	let settle: ((value: boolean) => void) | null = null;

	return {
		report(value: boolean) {
			settle?.(value);
		},
		isOpen(): Promise<boolean> {
			asked ??= new Promise<boolean>((resolve) => {
				// Boxed so `finish` can cancel a timer created after it — a
				// client can answer synchronously, before there is one.
				const deadline: { timer?: ReturnType<typeof setTimeout> } = {};
				const finish = (value: boolean) => {
					clearTimeout(deadline.timer);
					settle = null;
					asked = null;
					resolve(value);
				};
				// No client answered: assume the worst and serve nothing.
				deadline.timer = setTimeout(() => finish(false), timeoutMs);
				settle = finish;
				askClients();
			});
			return asked;
		},
	};
}

/**
 * Page side: report the gate state to the service worker, in reply to its
 * query. Best-effort — if there is no SW (unsupported, not yet registered)
 * there is no cache for it to guard either.
 */
export async function reportCacheGate(open: boolean): Promise<void> {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
	try {
		const reg = await navigator.serviceWorker.ready;
		reg.active?.postMessage({ type: CACHE_GATE_STATE, open });
	} catch {
		// Registration failed or was torn down — nothing to report to.
	}
}

/**
 * Page side: answer the service worker's queries with the current state.
 * Returns an unsubscribe function.
 */
export function answerCacheGateQueries(getOpen: () => boolean): () => void {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {};
	const listener = (event: MessageEvent) => {
		if ((event.data as { type?: string } | null)?.type === CACHE_GATE_QUERY) {
			void reportCacheGate(getOpen());
		}
	};
	navigator.serviceWorker.addEventListener('message', listener);
	// addEventListener alone does not start delivery: without either an
	// `onmessage` handler or this call, the spec queues SW→page messages
	// indefinitely and the query is never answered.
	navigator.serviceWorker.startMessages?.();
	return () => navigator.serviceWorker.removeEventListener('message', listener);
}
