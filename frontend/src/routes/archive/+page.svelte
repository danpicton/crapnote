<script lang="ts">
	import { onMount } from 'svelte';
	import { ArchiveRestore, Trash2, ChevronLeft } from 'lucide-svelte';
	import { api, type Note } from '$lib/api';

	let notes = $state<Note[]>([]);
	let loading = $state(true);
	let expandedId = $state<number | null>(null);

	onMount(async () => {
		notes = await api.notes.listArchived();
		loading = false;
	});

	async function unarchive(id: number) {
		await api.notes.unarchive(id);
		notes = notes.filter((n) => n.id !== id);
	}

	async function deleteNote(id: number) {
		if (!confirm('Permanently delete this note?')) return;
		await api.notes.delete(id);
		notes = notes.filter((n) => n.id !== id);
		if (expandedId === id) expandedId = null;
	}

	function toggleExpand(id: number) {
		expandedId = expandedId === id ? null : id;
	}
</script>

<svelte:head>
	<title>Archive — Crapnote</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<a href="/" class="back-btn" title="Back to notes" aria-label="Back to notes">
			<ChevronLeft size={20} />
		</a>
		<h1>Archive</h1>
	</header>

	{#if loading}
		<p class="status">Loading…</p>
	{:else if notes.length === 0}
		<p class="status">Archive is empty.</p>
	{:else}
		<ul class="note-list">
			{#each notes as note (note.id)}
				<li class="note-item" class:expanded={expandedId === note.id}>
					<div class="note-row">
						<button class="note-title-btn" onclick={() => toggleExpand(note.id)}>
							<span class="note-title">{note.title}</span>
							<span class="note-meta">{new Date(note.updated_at).toLocaleDateString()}</span>
						</button>
						<div class="note-actions">
							<button
								class="act-btn"
								onclick={() => unarchive(note.id)}
								title="Restore from archive"
								aria-label="Restore from archive"
							>
								<ArchiveRestore size={15} />
							</button>
							<button
								class="act-btn danger"
								onclick={() => deleteNote(note.id)}
								title="Delete permanently"
								aria-label="Delete permanently"
							>
								<Trash2 size={15} />
							</button>
						</div>
					</div>
					{#if expandedId === note.id}
						<div class="note-body">
							<pre class="body-text">{note.body || '(empty)'}</pre>
						</div>
					{/if}
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
		gap: 0.5rem;
		margin-bottom: 1.5rem;
	}

	.back-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.25rem;
		border-radius: 0.375rem;
		color: var(--text-3);
		text-decoration: none;
		flex-shrink: 0;
	}
	.back-btn:hover { background: var(--bg-hover); color: var(--text); }

	h1 { font-size: 1.5rem; margin: 0; }

	.status { color: var(--text-4); text-align: center; padding: 2rem; }

	.note-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.375rem; }

	.note-item {
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		overflow: hidden;
	}
	.note-item.expanded { border-color: var(--border-hi); }

	.note-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
	}

	.note-title-btn {
		flex: 1;
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
		padding: 0.25rem 0;
	}

	.note-title { font-weight: 600; font-size: 0.9rem; color: var(--text); }
	.note-meta { font-size: 0.75rem; color: var(--text-4); white-space: nowrap; }

	.note-actions { display: flex; gap: 0.25rem; flex-shrink: 0; }

	.act-btn {
		display: flex;
		align-items: center;
		padding: 0.3rem 0.4rem;
		background: none;
		border: none;
		border-radius: 0.25rem;
		cursor: pointer;
		color: var(--text-3);
	}
	.act-btn:hover { background: var(--bg-hover); color: var(--text-2); }
	.act-btn.danger:hover { background: var(--danger-bg); color: var(--danger); }

	.note-body {
		border-top: 1px solid var(--border);
		background: var(--bg-alt);
		padding: 0.75rem 1rem;
	}

	.body-text {
		margin: 0;
		font-family: system-ui, -apple-system, sans-serif;
		font-size: 0.875rem;
		color: var(--text-2);
		white-space: pre-wrap;
		word-break: break-word;
		line-height: 1.5;
	}
</style>
