<script lang="ts">
	import { onMount } from 'svelte';
	import { goto, preloadCode } from '$app/navigation';
	import { page } from '$app/stores';
	import { auth } from '$lib/stores/auth.svelte';
	import { theme } from '$lib/stores/theme.svelte';
	import { registerSW } from '$lib/sw-register';
	import OfflineUnlock from '$lib/components/OfflineUnlock.svelte';

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

<!--
	A restored-but-unproven identity never reaches the app. The notes routes
	read the offline cache on mount, so gating inside them alone would still
	let a frame of the previous user's titles paint before the guard cleared
	it; withholding `children` means those components are never constructed.

	`auth.locked` is false until the session check resolves, so this has to
	wait for `auth.loading` too — otherwise the app renders first and the
	notes route mounts (and fetches) on what turns out to be a locked start,
	which makes the sentence above false. The cost is that a cold load's
	/api/notes waits one round trip behind /api/auth/me. The routes keep their
	own `auth.canReadCache` check regardless: this gate is defence in depth,
	not a licence to drop that one.

	Public routes are never withheld — they render nothing cached, and putting
	a spinner in front of /login would block the only way back in.
-->
{#if isPublicPath($page.url.pathname)}
	{@render children()}
{:else if auth.loading}
	<div class="app-loading" data-testid="app-loading" aria-busy="true" aria-live="polite">
		<span class="sr-only">Loading…</span>
	</div>
{:else if auth.locked}
	<OfflineUnlock />
{:else}
	{@render children()}
{/if}

<style>
	.app-loading {
		min-height: 100dvh;
		background: var(--bg);
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
