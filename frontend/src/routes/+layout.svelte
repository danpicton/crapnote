<script lang="ts">
	import { onMount } from 'svelte';
	import { goto, preloadCode } from '$app/navigation';
	import { page } from '$app/stores';
	import { auth } from '$lib/stores/auth.svelte';
	import { theme } from '$lib/stores/theme.svelte';
	import { registerSW } from '$lib/sw-register';

	let { children } = $props();

	function isPublicPath(path: string): boolean {
		return path === '/login' || path.startsWith('/setup/');
	}

	// Every route in the app. Client-side navigation lazy-loads each route's
	// JS chunk on first visit, so a screen never opened while online can't
	// open offline — the dynamic import fails and SvelteKit shows its 500
	// error page. Pre-importing all route code at startup puts every screen
	// in the browser's module registry, so clicks keep working the moment
	// the network drops — even before the service worker controls the page
	// (first-ever visit, or the install window after a deploy).
	const ALL_ROUTES = [
		'/',
		'/notes/*',
		'/archive',
		'/archive/*',
		'/settings',
		'/trash',
		'/login',
		'/share',
		'/admin',
		'/setup/*',
	];

	/**
	 * Fire-and-forget pre-import of all route code. Individual failures are
	 * ignored (a chunk that fails now is retried on the next reconnect); the
	 * `window.__crapnoteRoutesPreloaded` flag flips once a full pass
	 * succeeds, so E2E tests can wait for offline-readiness deterministically.
	 */
	async function preloadAllRoutes() {
		const results = await Promise.allSettled(ALL_ROUTES.map((r) => preloadCode(r)));
		if (results.every((r) => r.status === 'fulfilled')) {
			(window as Window & { __crapnoteRoutesPreloaded?: boolean }).__crapnoteRoutesPreloaded = true;
		}
	}

	onMount(async () => {
		registerSW();
		void preloadAllRoutes();
		window.addEventListener('online', () => void preloadAllRoutes());
		// Fire-and-forget: init paints the local theme synchronously, then
		// fetches the admin-set global default without blocking auth/redirects.
		void theme.init();
		await auth.init();
		const currentPath = $page.url.pathname;
		if (!auth.user && !isPublicPath(currentPath)) {
			// Replace the current history entry so "back" doesn't return to the
			// protected page after being redirected to login.
			goto('/login', { replaceState: true });
		} else if (auth.user && currentPath === '/login') {
			goto('/', { replaceState: true });
		}
	});
</script>

{@render children()}
