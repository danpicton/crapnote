<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api, type TrashEntry } from '$lib/api';

	let entries = $state<TrashEntry[]>([]);
	let loading = $state(true);

	onMount(async () => {
		entries = await api.trash.list();
		loading = false;
	});

	async function restore(noteId: number) {
		await api.trash.restore(noteId);
		entries = entries.filter((e) => e.note_id !== noteId);
	}

	async function deleteOne(noteId: number) {
		await api.trash.deleteOne(noteId);
		entries = entries.filter((e) => e.note_id !== noteId);
	}

	async function empty() {
		if (!confirm('Permanently delete all trashed notes?')) return;
		await api.trash.empty();
		entries = [];
	}

	function daysLeft(permanentDeleteAt: string): number {
		const diff = new Date(permanentDeleteAt).getTime() - Date.now();
		return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
	}
</script>

<svelte:head>
	<title>Trash — CrapNote</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<a href="/" class="back-link">← Notes</a>
		<h1>Trash</h1>
		<button class="danger-btn" onclick={empty} disabled={entries.length === 0}>
			Empty trash
		</button>
	</header>

	{#if loading}
		<p class="status">Loading…</p>
	{:else if entries.length === 0}
		<p class="status">Trash is empty.</p>
	{:else}
		<ul class="entry-list">
			{#each entries as entry (entry.note_id)}
				<li class="entry">
					<div class="entry-info">
						<span class="entry-title">{entry.title}</span>
						<span class="entry-meta">
							Deleted {new Date(entry.deleted_at).toLocaleDateString()} ·
							<span class="countdown">{daysLeft(entry.permanent_delete_at)} days until permanent deletion</span>
						</span>
					</div>
					<div class="entry-actions">
						<button class="restore-btn" onclick={() => restore(entry.note_id)}>Restore</button>
						<button class="delete-btn" onclick={() => deleteOne(entry.note_id)}>Delete permanently</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.page {
		max-width: 720px;
		margin: 0 auto;
		padding: 2rem 1rem;
	}

	.page-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	h1 {
		flex: 1;
		font-size: 1.5rem;
		margin: 0;
	}

	.back-link {
		color: #6366f1;
		text-decoration: none;
		font-size: 0.875rem;
	}

	.danger-btn {
		padding: 0.375rem 0.75rem;
		background: #dc2626;
		color: white;
		border: none;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
	}

	.danger-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.status {
		color: #9ca3af;
		text-align: center;
		padding: 2rem;
	}

	.entry-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.entry {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 0.5rem;
	}

	.entry-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.entry-title {
		font-weight: 500;
	}

	.entry-meta {
		font-size: 0.75rem;
		color: #9ca3af;
	}

	.countdown {
		color: #f59e0b;
	}

	.entry-actions {
		display: flex;
		gap: 0.5rem;
	}

	.restore-btn {
		padding: 0.25rem 0.625rem;
		background: #6366f1;
		color: white;
		border: none;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
	}

	.delete-btn {
		padding: 0.25rem 0.625rem;
		background: #fee2e2;
		color: #dc2626;
		border: 1px solid #fecaca;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
	}
</style>
