<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { api } from '$lib/api';
	import { auth } from '$lib/stores/auth.svelte';
	import {
		buildSharedNote,
		hasShareContent,
		readSharePayload,
		stashShare,
		takeStashedShare,
		type SharePayload,
	} from '$lib/share';

	// Landing page for the manifest's share_target. The share sheet navigates
	// here with the shared fields in the query string; we turn them into a note
	// and hand the user straight to it.
	let status = $state<'working' | 'error'>('working');
	let message = $state('Saving shared content…');

	onMount(async () => {
		const params = $page.url.searchParams;
		// `restore=1` means we bounced through the login page and the payload is
		// waiting in session storage rather than the URL.
		const payload: SharePayload =
			params.get('restore') === '1'
				? (takeStashedShare() ?? {})
				: readSharePayload(params);

		if (!hasShareContent(payload)) {
			await goto('/', { replaceState: true });
			return;
		}

		await auth.init();
		if (!auth.user) {
			// Hold the share so signing in doesn't discard what was shared.
			stashShare(payload);
			await goto('/login', { replaceState: true });
			return;
		}

		const { title, body } = buildSharedNote(payload);
		try {
			const note = await api.notes.create(title, body);
			await goto(`/notes/${note.id}`, { replaceState: true });
		} catch {
			// Keep the payload so the retry button has something to work with.
			stashShare(payload);
			status = 'error';
			message = "Couldn't save the shared content.";
		}
	});

	function retry() {
		status = 'working';
		message = 'Saving shared content…';
		void goto('/share?restore=1', { replaceState: true }).then(() => location.reload());
	}
</script>

<svelte:head><title>Saving share · Crapnote</title></svelte:head>

<div class="share-page">
	<p class="share-message" role="status">{message}</p>
	{#if status === 'error'}
		<div class="share-actions">
			<button class="share-btn" onclick={retry}>Try again</button>
			<a class="share-link" href="/">Back to notes</a>
		</div>
	{/if}
</div>

<style>
	.share-page {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		min-height: 100vh;
		padding: 2rem;
		text-align: center;
		background: var(--bg);
		color: var(--text-2);
		font-family: var(--sans);
	}
	.share-message {
		margin: 0;
		font-size: 0.95rem;
	}
	.share-actions {
		display: flex;
		align-items: center;
		gap: 1rem;
	}
	.share-btn {
		padding: 0.5rem 1rem;
		border: 1px solid var(--border);
		border-radius: 0.375rem;
		background: var(--bg-alt);
		color: var(--text);
		font-family: inherit;
		font-size: 0.875rem;
		cursor: pointer;
	}
	.share-btn:hover {
		border-color: var(--accent);
	}
	.share-link {
		color: var(--accent);
		font-size: 0.875rem;
	}
</style>
