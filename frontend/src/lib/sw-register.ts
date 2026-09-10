let imageCacheUserId: number | null = null;
let workerListenersInstalled = false;

function postImageCacheIdentity(worker: ServiceWorker | null): Promise<void> {
	if (!worker) return Promise.resolve();
	return new Promise((resolve) => {
		const channel = new MessageChannel();
		const timeout = window.setTimeout(resolve, 1000);
		channel.port1.onmessage = () => {
			window.clearTimeout(timeout);
			resolve();
		};
		try {
			worker.postMessage(
				{ type: 'crapnote:image-cache-identity', userId: imageCacheUserId },
				[channel.port2]
			);
		} catch {
			window.clearTimeout(timeout);
			resolve();
		}
	});
}

/**
 * Tells the controlling worker whether this page has proved an identity. The
 * worker still compares the id with the offline-store owner before returning
 * an image from Cache Storage. `null` revokes this page's access.
 */
export async function setImageCacheIdentity(userId: number | null): Promise<void> {
	imageCacheUserId = userId;
	if (!('serviceWorker' in navigator)) return;
	try {
		const worker = navigator.serviceWorker.controller
			?? (await navigator.serviceWorker.getRegistration('/'))?.active
			?? null;
		await postImageCacheIdentity(worker);
	} catch {
		// No usable worker means there is no worker cache to authorise. If one
		// takes control later, controllerchange sends the current state.
	}
}

/**
 * Register the service worker. Call once from the root layout's onMount.
 *
 * The SW pre-caches the SvelteKit build manifest so all routes work offline,
 * but it does NOT queue write requests itself — the app-layer IndexedDB
 * dirty-note sync (see offlineSync.ts) is the single source of truth for
 * replaying offline edits.
 */
export async function registerSW() {
	if (!('serviceWorker' in navigator)) return;

	if (!workerListenersInstalled) {
		workerListenersInstalled = true;
		navigator.serviceWorker.addEventListener('controllerchange', () => {
			void postImageCacheIdentity(navigator.serviceWorker.controller);
		});
		// A worker can be terminated and recreated without controllerchange.
		// Its replacement asks each still-open client to restore the identity
		// held by this page module before deciding an image-cache request.
		navigator.serviceWorker.addEventListener('message', (event) => {
			if (event.data?.type === 'crapnote:request-image-cache-identity') {
				void postImageCacheIdentity(navigator.serviceWorker.controller);
			}
		});
	}

	try {
		const reg = await navigator.serviceWorker.register('/service-worker.js', {
			scope: '/',
			type: 'module',
		});
		console.log('[SW] registered', reg.scope);
	} catch (err) {
		console.warn('[SW] registration failed', err);
	}
}
