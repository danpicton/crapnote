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
