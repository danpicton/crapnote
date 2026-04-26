<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ArchiveRestore, Trash2, ChevronLeft } from 'lucide-svelte';
	import { api, type Note } from '$lib/api';

	let notes = $state<Note[]>([]);
	let loading = $state(true);
	let expandedId = $state<number | null>(null);

	onMount(async () => {
		notes = await api.notes.listArchived();
		loading = false;
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			const target = e.target instanceof Element ? e.target : null;
			if (!target?.closest('input, textarea, [contenteditable]')) {
				void goto('/');
			}
		}
	}

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

<svelte:window onkeydown={handleKeydown} />

<div class="archive-page">
	<a href="/" class="wordmark">Crapnote<span class="wordmark-dot" aria-hidden="true"></span></a>
	<div class="archive-inner">
		<header class="page-header">
			<a href="/" class="back-btn" title="Back to notes" aria-label="Back to notes">
				<ChevronLeft size={20} />
			</a>
			<h1 class="page-title">Archive<span class="accent-dot" aria-hidden="true">.</span></h1>
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
								<span class="note-title">{note.title || 'Untitled'}</span>
								<span class="note-meta">
									{new Date(note.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
									· {new Date(note.updated_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
								</span>
							</button>
							<div class="note-actions">
								<button
									class="act-btn"
									onclick={() => unarchive(note.id)}
									title="Restore from archive"
									aria-label="Restore from archive"
								>
									<ArchiveRestore size={14} />
								</button>
								<button
									class="act-btn danger"
									onclick={() => deleteNote(note.id)}
									title="Delete permanently"
									aria-label="Delete permanently"
								>
									<Trash2 size={14} />
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
</div>

<style>
	.archive-page {
		height: 100dvh;
		overflow-y: auto;
		background: var(--bg);
		font-family: var(--sans);
	}

	.archive-inner {
		max-width: 1040px;
		margin: 0 auto;
		padding: 0 3rem;
	}

	.wordmark {
		position: fixed;
		top: 1.25rem;
		left: 1.25rem;
		z-index: 10;
		font-family: var(--serif);
		font-weight: 800;
		font-size: 1.5rem;
		letter-spacing: -0.04em;
		line-height: 1;
		color: var(--text);
		text-decoration: none;
		display: inline-flex;
		align-items: baseline;
	}
	.wordmark:hover { opacity: 0.8; }
	.wordmark-dot {
		display: inline-block;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--accent);
		margin-left: 3px;
		margin-bottom: 1px;
	}

	.page-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 2rem 0 1.5rem;
		border-bottom: 1px solid var(--border);
		margin-bottom: 0;
	}

	.back-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.25rem;
		color: var(--text-3);
		text-decoration: none;
		flex-shrink: 0;
	}
	.back-btn:hover { color: var(--text); }

	.page-title {
		font-family: var(--serif);
		font-weight: 700;
		font-size: 2.125rem;
		letter-spacing: -0.04em;
		line-height: 1;
		color: var(--text);
		margin: 0;
		flex: 1;
	}
	.accent-dot { color: var(--accent); }

	.status {
		color: var(--text-4);
		padding: 2rem 0;
		font-size: 0.875rem;
		font-family: var(--sans);
	}

	.note-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.note-item {
		border-bottom: 1px solid var(--border);
	}
	.note-item:first-child {
		border-top: 1px solid var(--border);
	}

	.note-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 0;
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
		padding: 0;
		font-family: var(--sans);
	}
	.note-title-btn:hover .note-title { color: var(--accent); }

	.note-title {
		font-family: var(--serif);
		font-weight: 600;
		font-size: 1rem;
		color: var(--text);
	}

	.note-meta {
		font-size: 0.6875rem;
		color: var(--text-4);
		white-space: nowrap;
		font-family: var(--sans);
		font-variant-numeric: tabular-nums;
	}

	.note-actions { display: flex; gap: 1px; flex-shrink: 0; }

	.act-btn {
		display: flex;
		align-items: center;
		padding: 0.3rem 0.35rem;
		background: none;
		border: 1px solid transparent;
		border-radius: 2px;
		cursor: pointer;
		color: var(--text-3);
	}
	.act-btn:hover { background: var(--bg-hover); color: var(--text-2); }
	.act-btn.danger:hover { background: var(--danger-bg); color: var(--danger); }

	.note-body {
		border-top: 1px solid var(--border);
		background: var(--bg-alt);
		padding: 0.75rem 0 1rem;
	}

	.body-text {
		margin: 0;
		font-family: var(--mono);
		font-size: 0.8125rem;
		color: var(--text-3);
		white-space: pre-wrap;
		word-break: break-word;
		line-height: 1.5;
	}

	@media (max-width: 640px) {
		.archive-inner { padding: 0 1rem; }
	}
</style>
