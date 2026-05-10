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
			const archived = await api.notes.listArchived();
			note = archived.find((n) => n.id === noteId) ?? null;
			if (!note) { goto('/archive'); return; }
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
		{#if note}
			<h1 class="topbar-title">{note.title || 'Untitled'}</h1>
		{/if}
	</div>

	{#if loading}
		<div class="loading">Loading…</div>
	{:else if note}
		<div class="editor-body">
			<Editor value={note.body ?? ''} readonly />
		</div>
		<div class="note-footer">
			<button class="footer-btn footer-restore" onclick={restore} title="Restore" aria-label="Restore">
				<ArchiveRestore size={18} aria-hidden="true" />
			</button>
			<button class="footer-btn footer-delete" onclick={deleteNote} title="Delete permanently" aria-label="Delete permanently">
				<Trash2 size={18} aria-hidden="true" />
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
		padding: calc(env(safe-area-inset-top, 0px) + 10px) 12px 8px;
		border-bottom: 1px solid var(--border);
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

	.topbar-title {
		flex: 1;
		font-family: var(--serif);
		font-weight: 700;
		font-size: 1.5rem;
		letter-spacing: -0.04em;
		line-height: 1.2;
		color: var(--text);
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
		justify-content: flex-end;
		gap: 6px;
		padding: 8px 12px calc(env(safe-area-inset-bottom, 0px) + 8px);
		border-top: 1px solid var(--border);
		background: var(--bg-alt);
		flex-shrink: 0;
	}

	.footer-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: 10px;
		border: none;
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
	}
	.footer-btn:hover { background: var(--bg-hover); color: var(--text); }

	.footer-delete { color: var(--danger); }
	.footer-delete:hover { background: var(--danger-bg); color: var(--danger); }
</style>
