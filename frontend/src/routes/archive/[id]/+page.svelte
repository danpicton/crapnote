<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { ChevronLeft, ArchiveRestore, Trash2 } from 'lucide-svelte';
	import { api, type Note } from '$lib/api';
	import Editor from '$lib/components/Editor.svelte';

	const noteId = $derived(Number($page.params.id));
	let note = $state<Note | null>(null);
	let loading = $state(true);

	onMount(async () => {
		try {
			note = await api.notes.get(noteId);
		} catch {
			goto('/archive');
			return;
		}
		loading = false;
	});

	async function restore() {
		if (!note) return;
		await api.notes.unarchive(noteId);
		goto('/archive');
	}

	async function deleteNote() {
		if (!confirm('Permanently delete this note?')) return;
		await api.notes.delete(noteId);
		goto('/archive');
	}
</script>

<svelte:head>
	<title>{note?.title || 'Archived note'} — Crapnote</title>
</svelte:head>

<div class="note-view">
	<div class="mob-topbar">
		<a href="/archive" class="topbar-btn" aria-label="Back to archive">
			<ChevronLeft size={22} />
		</a>
		<div class="topbar-spacer"></div>
	</div>

	{#if loading}
		<div class="loading">Loading…</div>
	{:else if note}
		<div class="note-header">
			<h1 class="note-title">{note.title || 'Untitled'}</h1>
		</div>
		<div class="editor-body">
			<Editor value={note.body ?? ''} readonly />
		</div>
		<div class="note-footer">
			<button class="footer-btn footer-restore" onclick={restore}>
				<ArchiveRestore size={16} aria-hidden="true" /> Restore
			</button>
			<button class="footer-btn footer-delete" onclick={deleteNote}>
				<Trash2 size={16} aria-hidden="true" /> Delete permanently
			</button>
		</div>
	{/if}
</div>

<style>
	.note-view {
		height: 100dvh;
		display: flex;
		flex-direction: column;
		background: var(--bg);
		font-family: var(--sans);
		overflow: hidden;
	}

	.mob-topbar {
		display: flex;
		align-items: center;
		padding: calc(env(safe-area-inset-top, 0px) + 10px) 8px 8px;
		flex-shrink: 0;
		gap: 4px;
	}

	.topbar-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: 10px;
		background: none;
		border: none;
		color: var(--text-2);
		cursor: pointer;
		text-decoration: none;
		flex-shrink: 0;
	}
	.topbar-btn:hover { background: var(--bg-hover); }

	.topbar-spacer { flex: 1; }

	.note-header {
		padding: 4px 22px 10px;
		flex-shrink: 0;
		border-bottom: 1px solid var(--border);
	}

	.note-title {
		font-family: var(--serif);
		font-weight: 700;
		font-size: 1.5rem;
		letter-spacing: -0.04em;
		line-height: 1.2;
		color: var(--text);
		margin: 0;
	}

	.loading {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-4);
		font-size: 0.875rem;
	}

	.editor-body {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	/* Override editor-container padding for mobile */
	.editor-body :global(.editor-container) { padding: 0; }
	.editor-body :global(.milkdown),
	.editor-body :global(.milkdown-root) { flex: 1; min-height: 0; }
	.editor-body :global(.ProseMirror) {
		padding: 16px 22px 24px;
		font-size: 17px;
		line-height: 1.55;
		text-align: left;
	}

	.note-footer {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px calc(env(safe-area-inset-bottom, 0px) + 8px);
		border-top: 1px solid var(--border);
		background: var(--bg-alt);
		flex-shrink: 0;
	}

	.footer-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 14px;
		border-radius: 8px;
		border: 1px solid var(--border);
		background: var(--bg);
		color: var(--text-2);
		font-size: 13px;
		font-family: var(--sans);
		cursor: pointer;
	}
	.footer-btn:hover { background: var(--bg-hover); }

	.footer-delete {
		color: var(--danger);
		border-color: var(--danger-bd);
		background: var(--danger-bg);
	}
	.footer-delete:hover { background: var(--danger); color: white; }
</style>
