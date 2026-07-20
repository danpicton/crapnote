<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { auth } from '$lib/stores/auth.svelte';
	import { theme } from '$lib/stores/theme.svelte';
	import { registerSW } from '$lib/sw-register';

	let { children } = $props();

	function isPublicPath(path: string): boolean {
		return path === '/login' || path.startsWith('/setup/');
	}

	onMount(async () => {
		registerSW();
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
