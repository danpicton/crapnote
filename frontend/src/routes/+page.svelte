<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import {
		toggleStrongCommand,
		toggleEmphasisCommand,
		toggleInlineCodeCommand,
		wrapInBlockquoteCommand,
		wrapInBulletListCommand,
		wrapInOrderedListCommand,
		insertHrCommand,
		createCodeBlockCommand,
	} from '@milkdown/kit/preset/commonmark';
	import { undoCommand, redoCommand } from '@milkdown/kit/plugin/history';
	import { toggleUnderlineCommand } from '$lib/milkdown/underline';
	import type { CmdKey } from '@milkdown/kit/core';
	import { api, type Note } from '$lib/api';
	import { auth } from '$lib/stores/auth.svelte';
	import Editor, { type EditorRef } from '$lib/components/Editor.svelte';

	// Lucide icons
	import {
		Bold, Italic, Underline, Quote, Code, FileCode2,
		List, ListOrdered, Minus, Undo2, Redo2,
		Plus, Star, Pin, Archive, Trash2, Settings, LogOut,
		ChevronLeft, ChevronRight, Search,
	} from 'lucide-svelte';

	let notes = $state<Note[]>([]);

	let selectedId = $state<number | null>(null);
	let search = $state('');
	let saving = $state(false);
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	// Mobile: track which panel is visible
	let mobileShowEditor = $state(false);
	// Editor command ref
	let editorRef = $state<EditorRef | null>(null);

	let selectedNote = $derived(notes.find((n) => n.id === selectedId) ?? null);

	async function loadNotes() {
		const params: { search?: string } = {};
		if (search) params.search = search;
		notes = await api.notes.list(params);
	}

	onMount(async () => {
		await loadNotes();
		if (notes.length > 0) selectedId = notes[0].id;
	});

	async function newNote() {
		const note = await api.notes.create();
		const firstUnpinned = notes.findIndex((n) => !n.pinned);
		if (firstUnpinned === -1) {
			notes = [...notes, note];
		} else {
			notes = [...notes.slice(0, firstUnpinned), note, ...notes.slice(firstUnpinned)];
		}
		selectedId = note.id;
		mobileShowEditor = true;
	}

	function selectNote(id: number) {
		selectedId = id;
		mobileShowEditor = true;
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
		const rest = notes.filter((n) => n.id !== updated.id);
		const full = [updated, ...rest];
		notes = [...full.filter((n) => n.pinned), ...full.filter((n) => !n.pinned)];
	}

	async function archiveNote(id: number) {
		await api.notes.archive(id);
		notes = notes.filter((n) => n.id !== id);
		if (selectedId === id) {
			selectedId = notes.length > 0 ? notes[0].id : null;
			if (!selectedId) mobileShowEditor = false;
		}
	}

	async function deleteNote(id: number) {
		await api.notes.delete(id);
		notes = notes.filter((n) => n.id !== id);
		if (selectedId === id) {
			selectedId = notes.length > 0 ? notes[0].id : null;
			if (!selectedId) mobileShowEditor = false;
		}
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

	// Toolbar helper
	function cmd(key: string | CmdKey<unknown>, payload?: unknown) {
		editorRef?.call(key, payload);
	}
</script>

<svelte:head>
	<title>Crapnote</title>
</svelte:head>

<div class="app" class:mobile-editor={mobileShowEditor}>
	<!-- ── Sidebar ── -->
	<aside class="sidebar">
		<header class="sidebar-header">
			<span class="app-name">Crapnote</span>
			{#if selectedId}
				<button class="hdr-btn mobile-show-editor" onclick={() => (mobileShowEditor = true)} title="View note" aria-label="View note">
					<ChevronRight size={18} />
				</button>
			{/if}
			<button class="hdr-btn" onclick={newNote} title="New note" aria-label="New note">
				<Plus size={18} />
			</button>
		</header>

		<div class="search-box">
			<Search size={14} class="search-icon" />
			<input
				type="search"
				placeholder="Search…"
				bind:value={search}
				oninput={handleSearch}
			/>
		</div>

		<ul class="note-list" role="list">
			{#each notes as note (note.id)}
				<li class="note-item" class:selected={note.id === selectedId}>
					<button class="note-btn" onclick={() => selectNote(note.id)}>
						<span class="note-title-row">
							<span class="note-title">{note.title}</span>
							<span class="note-badges">
								{#if note.pinned}<span title="Pinned"><Pin size={11} /></span>{/if}
								{#if note.starred}<span title="Starred"><Star size={11} /></span>{/if}
							</span>
						</span>
						<span class="note-date">{new Date(note.updated_at).toLocaleDateString()}</span>
					</button>
					<div class="note-actions">
						<button class="act-btn" onclick={() => toggleStar(note.id)} title={note.starred ? 'Unstar' : 'Star'}>
							<Star size={13} class={note.starred ? 'icon-active' : ''} />
						</button>
						<button class="act-btn" onclick={() => togglePin(note.id)} title={note.pinned ? 'Unpin' : 'Pin'}>
							<Pin size={13} class={note.pinned ? 'icon-active' : ''} />
						</button>
						<button class="act-btn" onclick={() => archiveNote(note.id)} title="Move to archive" aria-label="Move to archive">
							<Archive size={13} />
						</button>
						<button class="act-btn danger" onclick={() => deleteNote(note.id)} title="Delete">
							<Trash2 size={13} />
						</button>
					</div>
				</li>
			{/each}
			{#if notes.length === 0}
				<li class="empty">No notes yet.</li>
			{/if}
		</ul>

		<div class="sidebar-bottom">
			<div class="bottom-left">
				<a href="/archive" class="bottom-btn icon-only" title="Archive">
					<Archive size={16} />
				</a>
				<a href="/trash" class="bottom-btn icon-only" title="Trash">
					<Trash2 size={16} />
				</a>
			</div>
			<div class="bottom-right">
				<a href="/settings" class="bottom-btn icon-only" title="Settings">
					<Settings size={16} />
				</a>
				<button class="bottom-btn icon-only" onclick={handleLogout} title="Log out">
					<LogOut size={16} />
				</button>
			</div>
		</div>
	</aside>

	<!-- ── Editor pane ── -->
	<main class="editor-pane">
		{#if selectedNote}
			<!-- Toolbar (above title) -->
			<div class="toolbar" role="toolbar" aria-label="Formatting">
				<!-- Mobile back -->
				<button class="tb-btn mobile-back" onclick={() => (mobileShowEditor = false)} title="Back to notes">
					<ChevronLeft size={16} />
				</button>
				<span class="tb-sep mobile-sep"></span>

				<button class="tb-btn" onclick={() => cmd(toggleStrongCommand.key)} title="Bold">
					<Bold size={14} />
				</button>
				<button class="tb-btn" onclick={() => cmd(toggleEmphasisCommand.key)} title="Italic">
					<Italic size={14} />
				</button>
				<button class="tb-btn" onclick={() => cmd(toggleUnderlineCommand.key)} title="Underline">
					<Underline size={14} />
				</button>
				<span class="tb-sep"></span>
				<button class="tb-btn" onclick={() => cmd(wrapInBlockquoteCommand.key)} title="Quote">
					<Quote size={14} />
				</button>
				<button class="tb-btn" onclick={() => cmd(toggleInlineCodeCommand.key)} title="Inline code">
					<Code size={14} />
				</button>
				<button class="tb-btn" onclick={() => cmd(createCodeBlockCommand.key)} title="Code block">
					<FileCode2 size={14} />
				</button>
				<span class="tb-sep"></span>
				<button class="tb-btn" onclick={() => cmd(wrapInBulletListCommand.key)} title="Bullet list">
					<List size={14} />
				</button>
				<button class="tb-btn" onclick={() => cmd(wrapInOrderedListCommand.key)} title="Numbered list">
					<ListOrdered size={14} />
				</button>
				<button class="tb-btn" onclick={() => cmd(insertHrCommand.key)} title="Horizontal rule">
					<Minus size={14} />
				</button>
				<span class="tb-sep"></span>
				<button class="tb-btn" onclick={() => cmd(undoCommand.key)} title="Undo">
					<Undo2 size={14} />
				</button>
				<button class="tb-btn" onclick={() => cmd(redoCommand.key)} title="Redo">
					<Redo2 size={14} />
				</button>
				<span class="tb-spacer"></span>
				<span class="save-status">{saving ? 'Saving…' : ''}</span>
			</div>

			<!-- Title -->
			<div class="editor-header">
				<input
					class="title-input"
					type="text"
					value={selectedNote.title}
					oninput={(e) => scheduleAutoSave('title', (e.target as HTMLInputElement).value)}
					placeholder="Note title"
				/>
			</div>

			<!-- Editor body -->
			{#key selectedId}
				<Editor
					value={selectedNote.body}
					onchange={(md) => scheduleAutoSave('body', md)}
					bind:ref={editorRef}
				/>
			{/key}
		{:else}
			<div class="empty-state">
				<p>Select a note or create a new one.</p>
				<button onclick={newNote}><Plus size={16} /> New note</button>
			</div>
		{/if}
	</main>
</div>

<style>
	/* ─── Layout ─────────────────────────────────────────── */
	.app {
		display: flex;
		height: 100dvh; /* dvh handles mobile browser chrome */
		overflow: hidden;
	}

	/* ─── Sidebar ────────────────────────────────────────── */
	.sidebar {
		width: 260px;
		min-width: 200px;
		display: flex;
		flex-direction: column;
		border-right: 1px solid #e5e7eb;
		background: #f9fafb;
		flex-shrink: 0;
		overflow: hidden; /* clip children; note-list handles its own scroll */
	}

	.sidebar-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid #e5e7eb;
		flex-shrink: 0; /* never pushed off-screen */
	}

	.app-name { font-weight: 700; font-size: 1.125rem; }

	.hdr-btn {
		background: none;
		border: none;
		cursor: pointer;
		color: #6b7280;
		padding: 0.25rem;
		border-radius: 0.375rem;
		display: flex;
		align-items: center;
	}
	.hdr-btn:hover { background: #e5e7eb; color: #111827; }

	.search-box {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid #e5e7eb;
		color: #9ca3af;
		flex-shrink: 0; /* always visible above note list */
	}

	.search-box input {
		flex: 1;
		border: none;
		background: none;
		font-size: 0.875rem;
		outline: none;
		color: #111827;
	}

	/* ─── Note list ──────────────────────────────────────── */
	.note-list {
		flex: 1;
		min-height: 0; /* required: allows flex-child to shrink below content height */
		overflow-y: auto;
		list-style: none;
		margin: 0;
		padding: 0.25rem 0;
	}

	.note-item {
		position: relative;
		margin: 0 0.25rem 0.125rem;
		border-radius: 0.375rem;
	}

	.note-item.selected { background: #e0e7ff; }
	.note-item:hover:not(.selected) { background: #f3f4f6; }

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
		color: #111827;
	}

	.note-badges {
		display: flex;
		gap: 0.125rem;
		flex-shrink: 0;
		color: #9ca3af;
	}

	.note-date { font-size: 0.7rem; color: #9ca3af; padding-left: 0.125rem; }

	.note-actions {
		display: flex;
		gap: 0.125rem;
		padding: 0.125rem 0.25rem 0.25rem;
		opacity: 0;
		transition: opacity 0.1s;
	}
	.note-item:hover .note-actions { opacity: 1; }

	.act-btn {
		background: none;
		border: none;
		cursor: pointer;
		padding: 0.2rem 0.3rem;
		border-radius: 0.25rem;
		color: #9ca3af;
		display: flex;
		align-items: center;
	}
	.act-btn:hover { background: #e5e7eb; color: #374151; }
	.act-btn.danger:hover { color: #dc2626; background: #fef2f2; }

	:global(.icon-active) { color: #6366f1; }

	.empty { padding: 1.5rem 1rem; color: #9ca3af; font-size: 0.875rem; text-align: center; }

	/* ─── Sidebar bottom ─────────────────────────────────── */
	.sidebar-bottom {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 0.75rem;
		border-top: 1px solid #e5e7eb;
		flex-shrink: 0; /* always visible below note list */
	}

	.bottom-left { display: flex; gap: 0.25rem; }
	.bottom-right { display: flex; gap: 0.25rem; }

	.bottom-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
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
	.bottom-btn.icon-only { padding: 0.375rem; }

	/* ─── Editor pane ────────────────────────────────────── */
	.editor-pane {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0; /* allow flex shrinking */
		overflow: hidden;
	}

	/* ─── Toolbar ────────────────────────────────────────── */
	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.125rem;
		padding: 0.375rem 0.75rem;
		border-bottom: 1px solid #e5e7eb;
		background: #fafafa;
		flex-shrink: 0;
		flex-wrap: wrap;
	}

	.tb-btn {
		padding: 0.3rem 0.4rem;
		background: none;
		border: 1px solid transparent;
		border-radius: 0.25rem;
		cursor: pointer;
		color: #374151;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.tb-btn:hover { background: #e5e7eb; border-color: #d1d5db; }
	.tb-btn:active { background: #dbeafe; border-color: #93c5fd; }

	.tb-sep {
		width: 1px;
		height: 1rem;
		background: #e5e7eb;
		margin: 0 0.2rem;
		flex-shrink: 0;
	}

	.tb-spacer { flex: 1; }

	.save-status { font-size: 0.75rem; color: #9ca3af; white-space: nowrap; }

	/* Mobile back button — hidden on desktop */
	.mobile-back { display: none; }
	.mobile-sep { display: none; }
	.mobile-show-editor { display: none; }

	/* ─── Editor header (title) ──────────────────────────── */
	.editor-header {
		padding: 0.75rem 1rem 0.5rem;
		border-bottom: 1px solid #e5e7eb;
		flex-shrink: 0;
	}

	.title-input {
		width: 100%;
		font-size: 1.25rem;
		font-weight: 600;
		border: none;
		outline: none;
		padding: 0;
		background: transparent;
		font-family: system-ui, -apple-system, sans-serif;
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
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		background: #6366f1;
		color: white;
		border: none;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
	}

	/* ─── Mobile layout (<= 767px) ───────────────────────── */
	@media (max-width: 767px) {
		.app {
			flex-direction: column;
			height: 100dvh;
		}

		/* On mobile, sidebar is full screen by default */
		.sidebar {
			width: 100%;
			min-width: unset;
			flex: 1;
			border-right: none;
			overflow: hidden;
		}

		/* Editor pane hidden unless we're in mobile-editor mode */
		.editor-pane {
			display: none;
			position: fixed;
			inset: 0;
			z-index: 10;
			background: #fff;
		}

		/* When a note is selected on mobile, show editor full-screen */
		.app.mobile-editor .sidebar { display: none; }
		.app.mobile-editor .editor-pane { display: flex; }

		/* Show mobile back button */
		.mobile-back { display: flex; }
		.mobile-sep { display: block; }
		.mobile-show-editor { display: flex; }

		/* Tighter sidebar padding */
		.sidebar-header { padding: 0.625rem 1rem; }
		.note-item { margin: 0 0.125rem 0.125rem; }

		/* Always show note actions on mobile (no hover) */
		.note-actions { opacity: 1; }

		/* Larger touch targets */
		.act-btn { padding: 0.375rem 0.5rem; }
		.note-btn { padding: 0.625rem 0.5rem 0.375rem; }
	}
</style>
