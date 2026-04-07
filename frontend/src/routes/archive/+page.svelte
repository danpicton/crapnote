<script lang="ts">
	import { onMount } from 'svelte';
	import { api, type Note } from '$lib/api';

	let notes = $state<Note[]>([]);
	let loading = $state(true);

	onMount(async () => {
		notes = await api.notes.listArchived();
		loading = false;
	});

	async function unarchive(id: number) {
		await api.notes.unarchive(id);
		notes = notes.filter((n) => n.id !== id);
	}

	async function deleteNote(id: number) {
		await api.notes.delete(id);
		notes = notes.filter((n) => n.id !== id);
	}
</script>

<svelte:head>
	<title>Archive — CrapNote</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<a href="/" class="back-link">← Notes</a>
		<h1>Archive</h1>
	</header>

	{#if loading}
		<p class="status">Loading…</p>
	{:else if notes.length === 0}
		<p class="status">Archive is empty.</p>
	{:else}
		<ul class="note-list">
			{#each notes as note (note.id)}
				<li class="note-item">
					<div class="note-info">
						<span class="note-title">{note.title}</span>
						<span class="note-meta">{new Date(note.updated_at).toLocaleDateString()}</span>
					</div>
					<div class="note-actions">
						<button onclick={() => unarchive(note.id)}>Unarchive</button>
						<button class="danger" onclick={() => deleteNote(note.id)}>Delete</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.page { max-width: 720px; margin: 0 auto; padding: 2rem 1rem; }

	.page-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	h1 { flex: 1; font-size: 1.5rem; margin: 0; }

	.back-link { color: #6366f1; text-decoration: none; font-size: 0.875rem; }

	.status { color: #9ca3af; text-align: center; padding: 2rem; }

	.note-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }

	.note-item {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 0.5rem;
	}

	.note-info { flex: 1; display: flex; flex-direction: column; gap: 0.125rem; }

	.note-title { font-weight: 600; font-size: 0.9rem; }

	.note-meta { font-size: 0.75rem; color: #9ca3af; }

	.note-actions { display: flex; gap: 0.5rem; }

	.note-actions button {
		padding: 0.25rem 0.625rem;
		background: #6366f1;
		color: white;
		border: none;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.8rem;
	}

	.note-actions button.danger {
		background: #fee2e2;
		color: #dc2626;
		border: 1px solid #fecaca;
	}
</style>
