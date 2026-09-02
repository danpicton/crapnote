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
 * store, so the state has to be pushed to it. Two directions, because a SW is
 * killed while idle and restarted by the next fetch event with its memory
 * wiped:
 *
 *   - push: the page reports the state on load and on every change.
 *   - pull: a restarted SW asks its clients and waits briefly for an answer
 *     before falling back to shut. Without this, an offline owner's images
 *     would break after every SW restart until they reloaded the page.
 *
 * Both paths fail closed: no answer means no cached image.
 */

/** Page → SW: `{ type, open }`. */
export const CACHE_GATE_STATE = 'crapnote:cache-gate';
/** SW → page: "I have restarted, tell me the state again". */
export const CACHE_GATE_QUERY = 'crapnote:cache-gate-query';

/** How long a restarted SW waits for a client to answer before failing
 * closed. Long enough for a message round-trip to a live page, short enough
 * not to stall an image request noticeably. */
const DEFAULT_QUERY_TIMEOUT_MS = 500;

export interface CacheGate {
	/** Record what the page just reported. */
	report(open: boolean): void;
	/** Whether cached image bytes may be served right now. */
	isOpen(): Promise<boolean>;
}

/**
 * The SW-side gate. `askClients` is called at most once per unknown state to
 * prompt the page for a report (see CACHE_GATE_QUERY).
 */
export function createCacheGate(
	askClients: () => void,
	{ timeoutMs = DEFAULT_QUERY_TIMEOUT_MS }: { timeoutMs?: number } = {}
): CacheGate {
	let open: boolean | null = null;
	let waiting: Promise<boolean> | null = null;
	let settle: ((value: boolean) => void) | null = null;

	return {
		report(value: boolean) {
			open = value;
			settle?.(value);
		},
		async isOpen(): Promise<boolean> {
			if (open !== null) return open;
			waiting ??= new Promise<boolean>((resolve) => {
				const timer = setTimeout(() => {
					settle = null;
					waiting = null;
					// No client answered: assume the worst and serve nothing.
					resolve(false);
				}, timeoutMs);
				settle = (value) => {
					clearTimeout(timer);
					settle = null;
					waiting = null;
					resolve(value);
				};
				askClients();
			});
			return waiting;
		},
	};
}

/**
 * Page side: report the gate state to the service worker. Best-effort — if
 * there is no SW (unsupported, not yet registered) there is no cache for it
 * to guard either.
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
 * Page side: answer a restarted SW's query with the current state. Returns an
 * unsubscribe function.
 */
export function answerCacheGateQueries(getOpen: () => boolean): () => void {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {};
	const listener = (event: MessageEvent) => {
		if ((event.data as { type?: string } | null)?.type === CACHE_GATE_QUERY) {
			void reportCacheGate(getOpen());
		}
	};
	navigator.serviceWorker.addEventListener('message', listener);
	return () => navigator.serviceWorker.removeEventListener('message', listener);
}
