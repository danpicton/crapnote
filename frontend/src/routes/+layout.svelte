<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { auth } from '$lib/stores/auth.svelte';
	import { registerSW } from '$lib/sw-register';

	let { children } = $props();

	const PUBLIC_PATHS = ['/login'];

	onMount(async () => {
		registerSW();
		await auth.init();
		const currentPath = $page.url.pathname;
		if (!auth.user && !PUBLIC_PATHS.includes(currentPath)) {
			goto('/login');
		} else if (auth.user && currentPath === '/login') {
			goto('/');
		}
	});
</script>

{@render children()}
