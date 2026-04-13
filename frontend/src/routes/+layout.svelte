<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { auth } from '$lib/stores/auth.svelte';
	import { theme } from '$lib/stores/theme.svelte';
	import { registerSW } from '$lib/sw-register';

	let { children } = $props();

	const PUBLIC_PATHS = ['/login'];

	onMount(async () => {
		registerSW();
		theme.init(); // Apply stored/system theme before first render
		await auth.init();
		const currentPath = $page.url.pathname;
		if (!auth.user && !PUBLIC_PATHS.includes(currentPath)) {
			// Replace the current history entry so "back" doesn't return to the
			// protected page after being redirected to login.
			goto('/login', { replaceState: true });
		} else if (auth.user && currentPath === '/login') {
			goto('/', { replaceState: true });
		}
	});
</script>

{@render children()}
