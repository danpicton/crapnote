/**
 * Register the service worker and request a background sync on reconnect.
 * Call once from the root layout's onMount.
 */
export async function registerSW() {
	if (!('serviceWorker' in navigator)) return;

	try {
		const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
		console.log('[SW] registered', reg.scope);

		// When we come back online, flush the SW request queue.
		// Note: app-layer IndexedDB sync is handled by the main page's heartbeat,
		// not here, to avoid a race with the page's own online handler.
		window.addEventListener('online', async () => {
			if ('sync' in reg) {
				await (reg as ServiceWorkerRegistration & { sync: { register(tag: string): Promise<void> } }).sync.register('flush-offline-queue');
			} else {
				reg.active?.postMessage({ type: 'FLUSH_QUEUE' });
			}
		});
	} catch (err) {
		console.warn('[SW] registration failed', err);
	}
}
