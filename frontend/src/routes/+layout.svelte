<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { auth } from '$lib/stores/auth.svelte';
	import { theme } from '$lib/stores/theme.svelte';
	import { registerSW } from '$lib/sw-register';
	import { installPrompt } from '$lib/stores/install.svelte';

	let { children } = $props();

	function isPublicPath(path: string): boolean {
		return path === '/login' || path.startsWith('/setup/');
	}

	onMount(async () => {
		registerSW();
		window.addEventListener('beforeinstallprompt', (e) => {
			e.preventDefault();
			installPrompt.capture(e as Parameters<typeof installPrompt.capture>[0]);
		});
		theme.init();
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
