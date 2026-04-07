<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api, type Note, type Tag } from '$lib/api';
	import { auth } from '$lib/stores/auth.svelte';
	import Editor from '$lib/components/Editor.svelte';

	let notes = $state<Note[]>([]);
	let tags = $state<Tag[]>([]);
	let selectedId = $state<number | null>(null);
	let search = $state('');
	let saving = $state(false);
	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	let selectedNote = $derived(notes.find((n) => n.id === selectedId) ?? null);

	async function loadNotes() {
		const params: { search?: string } = {};
		if (search) params.search = search;
		notes = await api.notes.list(params);
	}

	onMount(async () => {
		await Promise.all([loadNotes(), api.tags.list().then((t) => (tags = t))]);
		if (notes.length > 0) selectedId = notes[0].id;
	});

	async function newNote() {
		const note = await api.notes.create();
		// Insert after pinned notes so pinned order is preserved.
		const firstUnpinned = notes.findIndex((n) => !n.pinned);
		if (firstUnpinned === -1) {
			notes = [...notes, note];
		} else {
			notes = [...notes.slice(0, firstUnpinned), note, ...notes.slice(firstUnpinned)];
		}
		selectedId = note.id;
	}

	function scheduleAutoSave(field: 'title' | 'body', value: string) {
		if (!selectedId) return;
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(async () => {
			if (!selectedId) return;
			saving = true;
			try {
				const updated = await api.notes.update(selectedId, { [field]: value });
				notes = notes.map((n) => (n.id === updated.id ? updated : n));
			} finally {
				saving = false;
			}
		}, 800);
	}

	async function toggleStar(id: number) {
		const updated = await api.notes.toggleStar(id);
		notes = notes.map((n) => (n.id === updated.id ? updated : n));
	}

	async function togglePin(id: number) {
		const updated = await api.notes.togglePin(id);
		// Re-sort: pinned first, then by position
		const idx = notes.findIndex((n) => n.id === updated.id);
		const rest = notes.filter((n) => n.id !== updated.id);
		const newList = [updated, ...rest];
		notes = [...newList.filter((n) => n.pinned), ...newList.filter((n) => !n.pinned)];
		if (idx !== -1 && notes[0]?.id !== updated.id) {
			// keep selection stable
		}
	}

	async function archiveNote(id: number) {
		await api.notes.archive(id);
		notes = notes.filter((n) => n.id !== id);
		if (selectedId === id) selectedId = notes.length > 0 ? notes[0].id : null;
	}

	async function deleteNote(id: number) {
		await api.notes.delete(id);
		notes = notes.filter((n) => n.id !== id);
		if (selectedId === id) selectedId = notes.length > 0 ? notes[0].id : null;
	}

	async function handleLogout() {
		await auth.logout();
		goto('/login', { replaceState: true });
	}

	async function handleSearch() {
		await loadNotes();
		if (notes.length > 0 && !notes.find((n) => n.id === selectedId)) {
			selectedId = notes[0].id;
		}
	}
</script>

<svelte:head>
	<title>CrapNote</title>
</svelte:head>

<div class="app">
	<!-- Sidebar -->
	<aside class="sidebar">
		<header class="sidebar-header">
			<span class="app-name">CrapNote</span>
		</header>

		<div class="sidebar-actions">
			<button class="new-note-btn" onclick={newNote}>+ New note</button>
		</div>

		<div class="search-box">
			<input
				type="search"
				placeholder="Search notes…"
				bind:value={search}
				oninput={handleSearch}
			/>
		</div>

		<ul class="note-list" role="list">
			{#each notes as note (note.id)}
				<li class="note-item" class:selected={note.id === selectedId}>
					<button class="note-btn" onclick={() => (selectedId = note.id)}>
						<span class="note-title-row">
							<span class="note-title">{note.title}</span>
							<span class="note-badges">
								{#if note.pinned}<span class="badge" title="Pinned">📌</span>{/if}
								{#if note.starred}<span class="badge" title="Starred">⭐</span>{/if}
							</span>
						</span>
						<span class="note-date">{new Date(note.updated_at).toLocaleDateString()}</span>
					</button>
					<div class="note-actions">
						<button class="icon-btn" onclick={() => toggleStar(note.id)} title={note.starred ? 'Unstar' : 'Star'}>
							{note.starred ? '★' : '☆'}
						</button>
						<button class="icon-btn" onclick={() => togglePin(note.id)} title={note.pinned ? 'Unpin' : 'Pin'}>
							{note.pinned ? '📌' : '📍'}
						</button>
						<button class="icon-btn" onclick={() => archiveNote(note.id)} title="Move to archive" aria-label="Move to archive">
							🗂
						</button>
						<button class="icon-btn danger" onclick={() => deleteNote(note.id)} title="Delete">
							🗑
						</button>
					</div>
				</li>
			{/each}
			{#if notes.length === 0}
				<li class="empty">No notes yet.</li>
			{/if}
		</ul>

		<!-- Bottom bar -->
		<div class="sidebar-bottom">
			<a href="/archive" class="bottom-btn" title="Archive">📦 Archive</a>
			<div class="bottom-right">
				<a href="/settings" class="bottom-btn icon-only" title="Settings">⚙</a>
				<button class="bottom-btn icon-only" onclick={handleLogout} title="Log out">↩</button>
			</div>
		</div>
	</aside>

	<!-- Editor pane -->
	<main class="editor-pane">
		{#if selectedNote}
			<div class="editor-toolbar-area">
				<!-- Toolbar is rendered by the Editor component itself -->
			</div>
			<div class="editor-header">
				<input
					class="title-input"
					type="text"
					value={selectedNote.title}
					oninput={(e) => scheduleAutoSave('title', (e.target as HTMLInputElement).value)}
					placeholder="Note title"
				/>
				<span class="save-status">{saving ? 'Saving…' : ''}</span>
			</div>
			<!-- {#key} forces Editor to remount when switching notes, clearing stale content -->
			{#key selectedId}
				<Editor
					value={selectedNote.body}
					onchange={(md) => scheduleAutoSave('body', md)}
				/>
			{/key}
		{:else}
			<div class="empty-state">
				<p>Select a note or create a new one.</p>
				<button onclick={newNote}>+ New note</button>
			</div>
		{/if}
	</main>
</div>

<style>
	.app {
		display: flex;
		height: 100vh;
		overflow: hidden;
	}

	/* ── Sidebar ─────────────────────────────────────────── */
	.sidebar {
		width: 260px;
		min-width: 200px;
		display: flex;
		flex-direction: column;
		border-right: 1px solid #e5e7eb;
		background: #f9fafb;
	}

	.sidebar-header {
		padding: 0.75rem 1rem;
		border-bottom: 1px solid #e5e7eb;
	}

	.app-name {
		font-weight: 700;
		font-size: 1.125rem;
	}

	.sidebar-actions {
		padding: 0.5rem 0.75rem;
	}

	.new-note-btn {
		width: 100%;
		padding: 0.5rem;
		background: #6366f1;
		color: white;
		border: none;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
		font-weight: 500;
	}

	.new-note-btn:hover { background: #4f46e5; }

	.search-box {
		padding: 0.25rem 0.75rem 0.5rem;
	}

	.search-box input {
		width: 100%;
		padding: 0.375rem 0.5rem;
		border: 1px solid #d1d5db;
		border-radius: 0.375rem;
		font-size: 0.875rem;
		box-sizing: border-box;
	}

	/* ── Note list ───────────────────────────────────────── */
	.note-list {
		flex: 1;
		overflow-y: auto;
		list-style: none;
		margin: 0;
		padding: 0.25rem 0;
	}

	.note-item {
		position: relative;
		margin: 0 0.25rem;
		border-radius: 0.375rem;
	}

	.note-item.selected { background: #e0e7ff; }

	.note-btn {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		padding: 0.5rem 0.5rem 0.25rem;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
	}

	.note-title-row {
		display: flex;
		align-items: center;
		width: 100%;
		gap: 0.25rem;
	}

	.note-title {
		flex: 1;
		font-size: 0.875rem;
		font-weight: 700;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.note-badges {
		display: flex;
		gap: 0.125rem;
		flex-shrink: 0;
	}

	.badge { font-size: 0.75rem; }

	.note-date {
		font-size: 0.7rem;
		color: #6b7280;
		padding-left: 0.125rem;
	}

	.note-actions {
		display: flex;
		gap: 0.125rem;
		padding: 0 0.25rem 0.25rem;
		opacity: 0;
		transition: opacity 0.1s;
	}

	.note-item:hover .note-actions { opacity: 1; }

	.icon-btn {
		background: none;
		border: none;
		cursor: pointer;
		padding: 0.2rem 0.3rem;
		border-radius: 0.25rem;
		font-size: 0.8rem;
		color: #6b7280;
		line-height: 1;
	}

	.icon-btn:hover { background: #e5e7eb; }
	.icon-btn.danger:hover { color: #dc2626; background: #fef2f2; }

	.empty {
		padding: 1rem;
		color: #9ca3af;
		font-size: 0.875rem;
		text-align: center;
	}

	/* ── Sidebar bottom bar ──────────────────────────────── */
	.sidebar-bottom {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 0.75rem;
		border-top: 1px solid #e5e7eb;
	}

	.bottom-right {
		display: flex;
		gap: 0.25rem;
	}

	.bottom-btn {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.375rem 0.5rem;
		border-radius: 0.375rem;
		font-size: 0.8rem;
		color: #6b7280;
		background: none;
		border: none;
		cursor: pointer;
		text-decoration: none;
	}

	.bottom-btn:hover { background: #e5e7eb; color: #374151; }

	.bottom-btn.icon-only { padding: 0.375rem; font-size: 1rem; }

	/* ── Editor pane ─────────────────────────────────────── */
	.editor-pane {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		overflow: hidden;
	}

	.editor-toolbar-area {
		/* Reserved for toolbar rendered inside Editor */
	}

	.editor-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem 0.5rem;
		border-bottom: 1px solid #e5e7eb;
	}

	.title-input {
		flex: 1;
		font-size: 1.25rem;
		font-weight: 600;
		border: none;
		outline: none;
		padding: 0;
		background: transparent;
	}

	.save-status {
		font-size: 0.75rem;
		color: #9ca3af;
		min-width: 60px;
	}

	.empty-state {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		color: #9ca3af;
		gap: 1rem;
	}

	.empty-state button {
		padding: 0.5rem 1rem;
		background: #6366f1;
		color: white;
		border: none;
		border-radius: 0.375rem;
		cursor: pointer;
	}
</style>
