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
	import { insertImageCommand } from '$lib/milkdown/image';
	import { toggleLinkCommand } from '@milkdown/kit/preset/commonmark';
	import type { CmdKey } from '@milkdown/kit/core';
	import { PUBLIC_OFFLINE_NOTES_COUNT } from '$env/static/public';
	import { api, type Note, type Tag } from '$lib/api';
	import { auth } from '$lib/stores/auth.svelte';
	import Editor, { type EditorRef } from '$lib/components/Editor.svelte';
	import { openOfflineDB, getAllNotes, getNote, upsertNote, deleteNote as deleteOfflineNote } from '$lib/offlineDB';
	import type { CachedNote } from '$lib/offlineDB';
	import { syncOfflineChanges } from '$lib/offlineSync';

	const OFFLINE_NOTES_COUNT = Math.max(1, parseInt(PUBLIC_OFFLINE_NOTES_COUNT ?? '50', 10));

	// Lucide icons
	import {
		Bold, Italic, Underline, Quote, Code, FileCode2,
		List, ListOrdered, Minus, Undo2, Redo2, Image, Link,
		Plus, Star, Pin, Archive, Trash2, Settings, LogOut,
		ChevronRight, Search, Tag as TagIcon,
	} from 'lucide-svelte';

	let notes = $state<Note[]>([]);
	let isOnline = $state(typeof navigator !== 'undefined' ? navigator.onLine : true);

	let selectedId = $state<number | null>(null);
	let search = $state('');
	let saving = $state(false);
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	// Helpers for detecting mobile viewport
	function isMobile() { return window.matchMedia('(max-width: 767px)').matches; }
	// Editor command ref
	let editorRef = $state<EditorRef | null>(null);

	// Tags
	let allTags = $state<Tag[]>([]);
	let noteTags = $state<Tag[]>([]);
	let showTagPopover = $state(false);
	let newTagName = $state('');
	let activeTagId = $state<number | null>(null);
	let starredOnly = $state(false);

	const PALETTE = [
		// Reds / Pinks / Rose
		{ bg: '#fee2e2', text: '#991b1b' },   //  0 red
		{ bg: '#fce7f3', text: '#831843' },   //  1 pink
		{ bg: '#ffe4e6', text: '#881337' },   //  2 rose
		{ bg: '#fecdd3', text: '#9f1239' },   //  3 deep rose
		// Orange / Amber / Yellow / Lime
		{ bg: '#ffedd5', text: '#9a3412' },   //  4 orange
		{ bg: '#fef3c7', text: '#78350f' },   //  5 amber
		{ bg: '#fef9c3', text: '#854d0e' },   //  6 yellow
		{ bg: '#ecfccb', text: '#365314' },   //  7 lime
		// Greens
		{ bg: '#dcfce7', text: '#166534' },   //  8 green
		{ bg: '#d1fae5', text: '#064e3b' },   //  9 emerald
		{ bg: '#ccfbf1', text: '#134e4a' },   // 10 teal
		// Cyans / Sky / Blues / Indigo
		{ bg: '#cffafe', text: '#164e63' },   // 11 cyan
		{ bg: '#e0f2fe', text: '#0c4a6e' },   // 12 sky
		{ bg: '#dbeafe', text: '#1e3a8a' },   // 13 blue
		{ bg: '#e0e7ff', text: '#3730a3' },   // 14 indigo
		// Violet / Purple / Fuchsia
		{ bg: '#ede9fe', text: '#4c1d95' },   // 15 violet
		{ bg: '#f3e8ff', text: '#6b21a8' },   // 16 purple
		{ bg: '#fae8ff', text: '#86198f' },   // 17 fuchsia
		// Slightly deeper / -200 variants for more variety
		{ bg: '#fecaca', text: '#7f1d1d' },   // 18 deep red
		{ bg: '#fbcfe8', text: '#9d174d' },   // 19 deep pink
		{ bg: '#fda4af', text: '#881337' },   // 20 mid rose
		{ bg: '#fed7aa', text: '#7c2d12' },   // 21 deep orange
		{ bg: '#fde68a', text: '#78350f' },   // 22 deep amber
		{ bg: '#bbf7d0', text: '#14532d' },   // 23 deep green
		{ bg: '#99f6e4', text: '#134e4a' },   // 24 deep teal
		{ bg: '#bae6fd', text: '#0c4a6e' },   // 25 deep sky
		{ bg: '#bfdbfe', text: '#1e40af' },   // 26 deep blue
		{ bg: '#c7d2fe', text: '#3730a3' },   // 27 deep indigo
		{ bg: '#ddd6fe', text: '#5b21b6' },   // 28 deep violet
		{ bg: '#e9d5ff', text: '#6b21a8' },   // 29 deep purple
		{ bg: '#f5d0fe', text: '#86198f' },   // 30 deep fuchsia
		{ bg: '#a7f3d0', text: '#064e3b' },   // 31 deep emerald
	] as const;
	function tagColor(tag: Tag) {
		// Knuth multiplicative hash: top 5 bits of (id × golden-ratio-constant)
		// Spreads sequential IDs across the full 32-colour palette without clustering
		return PALETTE[Math.imul(tag.id, 0x9e3779b9) >>> 27];
	}

	// Only show tags that have at least one note (active or trashed); pure UI erasure
	let visibleTags = $derived(allTags.filter(t => t.note_count > 0));

	let selectedNote = $derived(notes.find((n) => n.id === selectedId) ?? null);

	function cachedToNote(c: CachedNote): Note {
		return {
			id: c.id,
			title: c.title,
			body: c.body,
			starred: c.starred,
			pinned: c.pinned,
			archived: false,
			created_at: c.server_updated_at,
			updated_at: c.local_updated_at,
		};
	}

	async function loadFromCache(): Promise<Note[]> {
		const db = await openOfflineDB();
		const cached = await getAllNotes(db);
		db.close();
		// Apply filters using cached metadata
		let filtered = cached;
		if (starredOnly) filtered = filtered.filter(n => n.starred);
		if (activeTagId !== null) filtered = filtered.filter(n => n.tags.some(t => t.id === activeTagId));
		if (search) {
			const term = search.toLowerCase();
			filtered = filtered.filter(n =>
				n.title.toLowerCase().includes(term) || n.body.toLowerCase().includes(term)
			);
		}
		// Pinned first, then most recently updated
		return filtered
			.sort((a, b) => {
				if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
				return new Date(b.local_updated_at).getTime() - new Date(a.local_updated_at).getTime();
			})
			.map(cachedToNote);
	}

	async function cacheNotesForOffline(serverNotes: Note[]): Promise<void> {
		const db = await openOfflineDB();

		const toKeep = new Set<number>();
		let count = 0;
		// Sort by updated_at DESC then include pinned regardless of rank
		const byDate = [...serverNotes].sort(
			(a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
		);
		for (const note of byDate) {
			if (count < OFFLINE_NOTES_COUNT) { toKeep.add(note.id); count++; }
			if (note.pinned) toKeep.add(note.id); // always cache pinned notes
		}

		for (const note of serverNotes) {
			if (!toKeep.has(note.id)) continue;
			const existing = await getNote(db, note.id);
			if (existing?.is_dirty) continue; // don't overwrite unsync'd local changes
			// Fetch tags for this note so they're available offline
			const noteTags = await api.tags.listForNote(note.id).catch(() => existing?.tags ?? []);
			await upsertNote(db, {
				id: note.id,
				title: note.title,
				body: note.body,
				starred: note.starred,
				pinned: note.pinned,
				tags: noteTags.map(t => ({ id: t.id, name: t.name })),
				server_updated_at: note.updated_at,
				local_updated_at: note.updated_at,
				is_dirty: false,
				is_new: false,
			});
		}

		// Evict notes no longer in the keep-set (unless dirty / new)
		const allCached = await getAllNotes(db);
		for (const c of allCached) {
			if (!toKeep.has(c.id) && !c.is_dirty && !c.is_new) {
				await deleteOfflineNote(db, c.id);
			}
		}

		db.close();
	}

	async function loadNotes() {
		if (!navigator.onLine) {
			notes = await loadFromCache();
			return;
		}
		const params: { search?: string; tag?: number; starred?: boolean } = {};
		if (search) params.search = search;
		if (activeTagId !== null) params.tag = activeTagId;
		if (starredOnly) params.starred = true;
		try {
			const fetched = await api.notes.list(params);
			notes = fetched;
			// Cache top-N when no filter is active (we want the canonical recent list)
			if (!search && activeTagId === null && !starredOnly) {
				cacheNotesForOffline(fetched); // fire-and-forget
			}
		} catch {
			// Network failed despite onLine — fall back to cache
			notes = await loadFromCache();
		}
	}

	onMount(async () => {
		isOnline = navigator.onLine;

		const handleOnline = async () => {
			isOnline = true;
			await syncOfflineChanges();
			await loadNotes();
			allTags = await api.tags.list().catch(() => allTags);
		};
		const handleOffline = () => { isOnline = false; };
		window.addEventListener('online', handleOnline);
		window.addEventListener('offline', handleOffline);

		await loadNotes();
		allTags = await api.tags.list().catch(() => []);
		// On mobile the list is the home screen; we never auto-open the editor.
		// On desktop, pre-select the first note so the editor pane isn't empty.
		if (!isMobile() && notes.length > 0 && selectedId === null) {
			const initId = notes[0].id;
			selectedId = initId;
			const tags = await api.tags.listForNote(initId).catch(() => []);
			// Only apply if no user action (newNote / selectNote) changed the
			// selection while we were awaiting the listForNote response.
			if (selectedId === initId) {
				noteTags = tags;
			}
		}

		return () => {
			window.removeEventListener('online', handleOnline);
			window.removeEventListener('offline', handleOffline);
		};
	});

	async function newNote() {
		if (!navigator.onLine) {
			const tempId = -Date.now();
			const now = new Date().toISOString();
			const cached: CachedNote = {
				id: tempId, title: '', body: '',
				starred: false, pinned: false, tags: [],
				server_updated_at: now, local_updated_at: now,
				is_dirty: true, is_new: true,
			};
			const db = await openOfflineDB();
			await upsertNote(db, cached);
			db.close();
			const note: Note = {
				id: tempId, title: '', body: '',
				starred: false, pinned: false, archived: false,
				created_at: now, updated_at: now,
			};
			notes = [note, ...notes];
			selectedId = tempId;
			noteTags = [];
			if (isMobile()) { goto(`/notes/${tempId}`); return; }
			return;
		}
		const note = await api.notes.create();
		const firstUnpinned = notes.findIndex((n) => !n.pinned);
		if (firstUnpinned === -1) {
			notes = [...notes, note];
		} else {
			notes = [...notes.slice(0, firstUnpinned), note, ...notes.slice(firstUnpinned)];
		}
		selectedId = note.id;
		noteTags = [];
		if (isMobile()) { goto(`/notes/${note.id}`); return; }
	}

	async function selectNote(id: number) {
		if (isMobile()) { goto(`/notes/${id}`); return; }
		selectedId = id;
		showTagPopover = false;
		noteTags = await api.tags.listForNote(id);
	}

	let tagFilterEl = $state<HTMLDivElement | null>(null);
	let tagFilterExpanded = $state(false);
	let tagFilterScrollable = $state(false);

	function onTagFilterMouseEnter() {
		if (isMobile()) return; // touch devices fire mouseenter on tap — skip to avoid layout jump
		tagFilterExpanded = true;
	}
	function onTagFilterMouseLeave() {
		if (isMobile()) return;
		tagFilterScrollable = false;
		tagFilterExpanded = false;
		if (tagFilterEl) tagFilterEl.scrollTop = 0;
	}
	function onTagFilterTransitionEnd() {
		if (tagFilterExpanded) tagFilterScrollable = true;
	}

	async function applyFilter(tagId: number | null, starred: boolean) {
		activeTagId = tagId;
		starredOnly = starred;
		await loadNotes();
		if (notes.length > 0 && !notes.find(n => n.id === selectedId)) {
			selectedId = notes[0].id;
			noteTags = await api.tags.listForNote(notes[0].id);
		} else if (notes.length === 0) {
			selectedId = null;
			noteTags = [];
		}
	}

	function filterByTag(id: number | null) {
		return applyFilter(id, starredOnly);
	}

	function toggleStarFilter() {
		return applyFilter(activeTagId, !starredOnly);
	}

	async function toggleTag(tag: Tag) {
		if (!selectedId) return;
		const has = noteTags.find(t => t.id === tag.id);
		if (has) {
			await api.tags.removeFromNote(selectedId, tag.id);
			noteTags = noteTags.filter(t => t.id !== tag.id);
		} else {
			await api.tags.addToNote(selectedId, tag.id);
			noteTags = [...noteTags, tag];
		}
		// Refresh note_count so pseudo-erasure stays accurate
		allTags = await api.tags.list();
	}

	async function createAndAddTag() {
		if (!selectedId || !newTagName.trim()) return;
		const name = newTagName.trim();
		let tag = allTags.find(t => t.name.toLowerCase() === name.toLowerCase());
		if (!tag) {
			tag = await api.tags.create(name);
		}
		if (!noteTags.find(t => t.id === tag!.id)) {
			await api.tags.addToNote(selectedId, tag.id);
			noteTags = [...noteTags, tag];
		}
		newTagName = '';
		allTags = await api.tags.list();
	}

	function scheduleAutoSave(field: 'title' | 'body', value: string) {
		if (!selectedId) return;
		if (saveTimer) clearTimeout(saveTimer);
		const idAtSchedule = selectedId;
		saveTimer = setTimeout(async () => {
			if (!selectedId) return;
			saving = true;
			try {
				if (!navigator.onLine) {
					// Save to IndexedDB and mark dirty
					const db = await openOfflineDB();
					const existing = await getNote(db, idAtSchedule);
					if (existing) {
						await upsertNote(db, {
							...existing,
							[field]: value,
							local_updated_at: new Date().toISOString(),
							is_dirty: true,
						});
					} else {
						// Note not yet in cache (was online when it loaded) — create a cache entry
						const currentNote = notes.find(n => n.id === idAtSchedule);
						if (currentNote) {
							await upsertNote(db, {
								id: currentNote.id,
								title: field === 'title' ? value : currentNote.title,
								body: field === 'body' ? value : currentNote.body,
								starred: currentNote.starred,
								pinned: currentNote.pinned,
								tags: noteTags.map(t => ({ id: t.id, name: t.name })),
								server_updated_at: currentNote.updated_at,
								local_updated_at: new Date().toISOString(),
								is_dirty: true,
								is_new: false,
							});
						}
					}
					db.close();
					notes = notes.map(n => n.id === idAtSchedule ? { ...n, [field]: value } : n);
				} else {
					try {
						const updated = await api.notes.update(idAtSchedule, { [field]: value });
						notes = notes.map((n) => (n.id === updated.id ? updated : n));
						// Keep cache in sync
						const db = await openOfflineDB();
						const existing = await getNote(db, updated.id);
						if (existing && !existing.is_dirty) {
							await upsertNote(db, {
								...existing,
								title: updated.title,
								body: updated.body,
								server_updated_at: updated.updated_at,
								local_updated_at: updated.updated_at,
							});
						}
						db.close();
					} catch {
						// Lost connectivity during save — fall back to offline save
						const db = await openOfflineDB();
						const currentNote = notes.find(n => n.id === idAtSchedule);
						if (currentNote) {
							const existing = await getNote(db, idAtSchedule);
							await upsertNote(db, {
								id: currentNote.id,
								title: field === 'title' ? value : currentNote.title,
								body: field === 'body' ? value : currentNote.body,
								starred: currentNote.starred,
								pinned: currentNote.pinned,
								tags: existing?.tags ?? noteTags.map(t => ({ id: t.id, name: t.name })),
								server_updated_at: currentNote.updated_at,
								local_updated_at: new Date().toISOString(),
								is_dirty: true,
								is_new: existing?.is_new ?? false,
							});
						}
						db.close();
						notes = notes.map(n => n.id === idAtSchedule ? { ...n, [field]: value } : n);
					}
				}
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
		}
	}

	async function deleteNote(id: number) {
		await api.notes.delete(id);
		notes = notes.filter((n) => n.id !== id);
		if (selectedId === id) {
			selectedId = notes.length > 0 ? notes[0].id : null;
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
			noteTags = await api.tags.listForNote(notes[0].id);
		}
	}

	// Toolbar helper
	function cmd(key: string | CmdKey<unknown>, payload?: unknown) {
		editorRef?.call(key, payload);
	}

	// Link dialog
	let showLinkDialog = $state(false);
	let linkDialogHref = $state('');

	function focusInput(node: HTMLInputElement) {
		node.focus();
	}

	function openLinkDialog() {
		linkDialogHref = '';
		showLinkDialog = true;
	}

	function applyLink() {
		const href = linkDialogHref.trim();
		if (href) cmd(toggleLinkCommand.key as CmdKey<unknown>, { href });
		showLinkDialog = false;
	}

	function linkInputKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
		if (e.key === 'Escape') { showLinkDialog = false; }
	}
</script>

<svelte:head>
	<title>Crapnote</title>
</svelte:head>

<div class="app">
	<!-- ── Sidebar ── -->
	<aside class="sidebar">
		<header class="sidebar-header">
			<span class="app-name">Crapnote</span>
			{#if !isOnline}
				<span class="offline-badge" title="You are offline — changes will sync when reconnected">Offline</span>
			{/if}
			{#if selectedId}
				<button class="hdr-btn mobile-show-editor" onclick={() => goto(`/notes/${selectedId}`)} title="View note" aria-label="View note">
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

		<div class="filter-bar" role="group" aria-label="Filter notes">
			<div class="filter-fixed">
				<button
					class="tag-pill"
					class:tag-pill-active={activeTagId === null && !starredOnly}
					onclick={() => applyFilter(null, false)}
				>All</button>
				<button
					class="tag-pill tag-pill-star"
					class:tag-pill-active={starredOnly}
					onclick={toggleStarFilter}
					title="Starred notes"
				><Star size={11} /> Starred</button>
			</div>
			{#if visibleTags.length > 0}
				<div
					class="filter-tags"
					class:expanded={tagFilterExpanded}
					class:scrollable={tagFilterScrollable}
					bind:this={tagFilterEl}
					role="group"
					aria-label="Tag filters"
					onmouseenter={onTagFilterMouseEnter}
					onmouseleave={onTagFilterMouseLeave}
					ontransitionend={onTagFilterTransitionEnd}
				>
					{#each visibleTags as tag (tag.id)}
						{@const c = tagColor(tag)}
						<button
							class="tag-pill"
							class:tag-pill-active={activeTagId === tag.id}
							style="--tag-bg:{c.bg};--tag-text:{c.text}"
							onclick={() => filterByTag(activeTagId === tag.id ? null : tag.id)}
							title="{tag.name} ({tag.note_count})"
						>{tag.name}</button>
					{/each}
				</div>
			{/if}
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
				<button class="tb-btn" onclick={() => cmd(toggleStrongCommand.key)} title="Bold">
					<Bold size={14} />
				</button>
				<button class="tb-btn" onclick={() => cmd(toggleEmphasisCommand.key)} title="Italic">
					<Italic size={14} />
				</button>
				<button class="tb-btn" onclick={() => cmd(toggleUnderlineCommand.key)} title="Underline">
					<Underline size={14} />
				</button>
				<div class="link-btn-wrap">
					<button class="tb-btn" onclick={openLinkDialog} title="Insert link (Ctrl+K)">
						<Link size={14} />
					</button>
					{#if showLinkDialog}
						<div class="link-dialog-backdrop" onclick={() => (showLinkDialog = false)} role="presentation"></div>
						<div class="link-dialog" role="dialog" aria-label="Insert link">
							<input
								class="link-dialog-input"
								type="url"
								placeholder="https://…"
								bind:value={linkDialogHref}
								onkeydown={linkInputKeydown}
								use:focusInput
							/>
							<button class="link-dialog-btn" onclick={applyLink}>Apply</button>
						</div>
					{/if}
				</div>
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
				<span class="tb-sep"></span>
				<button class="tb-btn" onclick={() => cmd(insertImageCommand.key)} title="Insert image">
					<Image size={14} />
				</button>
				<span class="tb-spacer"></span>
				<span class="save-status">{saving ? 'Saving…' : ''}</span>
			</div>

			<!-- Tags (above title) + Title + Popover button (absolute right) -->
			<div class="editor-header">
				{#if noteTags.length > 0}
					<div class="note-tags-chips">
						{#each noteTags as tag (tag.id)}
							{@const c = tagColor(tag)}
							<button
								class="note-tag-chip"
								style="--tag-bg:{c.bg};--tag-text:{c.text}"
								onclick={() => applyFilter(activeTagId === tag.id ? null : tag.id, starredOnly)}
								title="Filter by {tag.name}"
							><TagIcon size={9} />{tag.name}</button>
						{/each}
					</div>
				{/if}
				<input
					class="title-input"
					type="text"
					value={selectedNote.title}
					oninput={(e) => scheduleAutoSave('title', (e.target as HTMLInputElement).value)}
					placeholder="Note title"
				/>
				<!-- Popover button: always visible, absolutely pinned to top-right -->
				<!-- When no tags it sits level with the title; when tags exist it aligns with the first chip row -->
				<div class="tag-popover-wrap">
					<button
						class="tag-chip-btn"
						class:tag-chip-btn-active={noteTags.length > 0}
						onclick={() => (showTagPopover = !showTagPopover)}
						title="Tags"
					>
						<TagIcon size={11} />
						{#if noteTags.length > 0}<span class="tb-tag-count">{noteTags.length}</span>{/if}
					</button>
					{#if showTagPopover}
						<div class="tag-popover">
							<p class="popover-label">Tags</p>
							{#each visibleTags as tag (tag.id)}
								{@const c = tagColor(tag)}
								<label class="popover-item">
									<input type="checkbox" checked={!!noteTags.find(t => t.id === tag.id)} onchange={() => toggleTag(tag)} />
									<span class="popover-tag-dot" style="background:{c.text}"></span>
									{tag.name}
								</label>
							{/each}
							<div class="popover-new">
								<input
									class="popover-new-input"
									type="text"
									placeholder="New tag…"
									bind:value={newTagName}
									onkeydown={(e) => e.key === 'Enter' && createAndAddTag()}
								/>
								<button class="popover-add-btn" onclick={createAndAddTag}><Plus size={12} /></button>
							</div>
						</div>
					{/if}
				</div>
			</div>

			<!-- Editor body -->
			{#key selectedId}
				<Editor
					value={selectedNote.body}
					onchange={(md) => scheduleAutoSave('body', md)}
					bind:ref={editorRef}
					oninsertlink={openLinkDialog}
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
		border-right: 1px solid var(--border);
		background: var(--bg-alt);
		flex-shrink: 0;
		overflow: hidden; /* clip children; note-list handles its own scroll */
	}

	.sidebar-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--border);
		flex-shrink: 0; /* never pushed off-screen */
	}

	.app-name { font-weight: 700; font-size: 1.125rem; }

	.offline-badge {
		font-size: 0.65rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
		background: var(--warning-bg, #fef3c7);
		color: var(--warning-text, #92400e);
		border: 1px solid var(--warning-border, #fde68a);
	}

	.hdr-btn {
		background: none;
		border: none;
		cursor: pointer;
		color: var(--text-3);
		padding: 0.25rem;
		border-radius: 0.375rem;
		display: flex;
		align-items: center;
	}
	.hdr-btn:hover { background: var(--border); color: var(--text); }

	.search-box {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--border);
		color: var(--text-4);
		flex-shrink: 0; /* always visible above note list */
	}

	.search-box input {
		flex: 1;
		border: none;
		background: none;
		font-size: 0.875rem;
		outline: none;
		color: var(--text);
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

	.note-item.selected { background: var(--bg-select); }
	.note-item:hover:not(.selected) { background: var(--bg-hover); }

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
		color: var(--text);
	}

	.note-badges {
		display: flex;
		gap: 0.125rem;
		flex-shrink: 0;
		color: var(--text-4);
	}

	.note-date { font-size: 0.7rem; color: var(--text-4); padding-left: 0.125rem; }

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
		color: var(--text-4);
		display: flex;
		align-items: center;
	}
	.act-btn:hover { background: var(--border); color: var(--text-2); }
	.act-btn.danger:hover { color: var(--danger); background: var(--danger-bg); }

	:global(.icon-active) { color: var(--accent); }

	.empty { padding: 1.5rem 1rem; color: var(--text-4); font-size: 0.875rem; text-align: center; }

	/* ─── Sidebar bottom ─────────────────────────────────── */
	.sidebar-bottom {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 0.75rem;
		border-top: 1px solid var(--border);
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
		color: var(--text-3);
		background: none;
		border: none;
		cursor: pointer;
		text-decoration: none;
	}
	.bottom-btn:hover { background: var(--border); color: var(--text-2); }
	.bottom-btn.icon-only { padding: 0.375rem; }

	/* ─── Editor pane ────────────────────────────────────── */
	.editor-pane {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0; /* allow flex shrinking */
		overflow: hidden;
		background: var(--bg);
	}

	/* ─── Toolbar ────────────────────────────────────────── */
	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.125rem;
		padding: 0.375rem 0.75rem;
		border-bottom: 1px solid var(--border);
		background: var(--bg-toolbar);
		flex-shrink: 0;
		flex-wrap: wrap;
	}

	.tb-btn {
		padding: 0.3rem 0.4rem;
		background: none;
		border: 1px solid transparent;
		border-radius: 0.25rem;
		cursor: pointer;
		color: var(--text-2);
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.tb-btn:hover { background: var(--border); border-color: var(--border-md); }
	.tb-btn:active { background: var(--bg-active); border-color: var(--border-hi); }

	.tb-sep {
		width: 1px;
		height: 1rem;
		background: var(--border);
		margin: 0 0.2rem;
		flex-shrink: 0;
	}

	.tb-spacer { flex: 1; }

	.save-status { font-size: 0.75rem; color: var(--text-4); white-space: nowrap; }

	.link-btn-wrap {
		position: relative;
		display: inline-flex;
	}

	.link-dialog-backdrop {
		position: fixed;
		inset: 0;
		z-index: 49;
	}

	.link-dialog {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		box-shadow: var(--shadow);
		padding: 0.4rem;
		display: flex;
		gap: 0.25rem;
		z-index: 50;
		min-width: 14rem;
	}

	.link-dialog-input {
		flex: 1;
		border: 1px solid var(--border-md);
		border-radius: 0.25rem;
		padding: 0.25rem 0.4rem;
		font-size: 0.8rem;
		outline: none;
		min-width: 0;
		background: var(--bg);
		color: var(--text);
	}
	.link-dialog-input:focus { border-color: var(--accent); }

	.link-dialog-btn {
		background: var(--accent);
		color: white;
		border: none;
		border-radius: 0.25rem;
		padding: 0.25rem 0.6rem;
		font-size: 0.8rem;
		cursor: pointer;
		white-space: nowrap;
		flex-shrink: 0;
	}
	.link-dialog-btn:hover { background: var(--accent-dk); }

	.mobile-show-editor { display: none; }

	/* ─── Editor header (tags + title) ─────────────────── */
	.editor-header {
		position: relative;
		/* Right padding reserves a clear gutter for the absolute popover button.
		   Sized to comfortably fit the button even with a 2-digit count badge. */
		padding: 0.45rem 5rem 0.45rem 1rem;
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}

	/* Chip row above the title (only rendered when note has tags) */
	.note-tags-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin-bottom: 0.3rem;
	}

	/* ─── Sidebar filter bar ─────────────────────────────── */
	.filter-bar {
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}

	/* Fixed row: All + Starred — always visible */
	.filter-fixed {
		display: flex;
		gap: 0.25rem;
		padding: 0.4rem 0.75rem 0.25rem;
	}

	/* Scrollable tag pills — 2 rows by default, expands to 4 rows (then scrolls) on hover */
	.filter-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		padding: 0 0.75rem 0.4rem;
		max-height: 2.55rem;
		overflow-y: hidden;
		transition: max-height 0.2s ease;
	}
	.filter-tags.expanded {
		max-height: 5.1rem;
	}
	.filter-tags.scrollable {
		overflow-y: auto;
	}

	.tag-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		padding: 0.15rem 0.55rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--tag-bg, transparent);
		color: var(--tag-text, var(--text-3));
		font-size: 0.7rem;
		font-weight: 500;
		cursor: pointer;
		transition: opacity 0.1s;
	}
	.tag-pill:hover { opacity: 0.8; }
	.tag-pill-active {
		border-color: var(--tag-text, var(--accent));
		box-shadow: 0 0 0 1.5px var(--tag-text, var(--accent));
	}
	/* "All" pill — no CSS vars, use themed indigo */
	.tag-pill:not([style]).tag-pill-active {
		background: var(--bg-select);
		color: var(--accent-tx);
		border-color: var(--accent);
		box-shadow: 0 0 0 1.5px var(--accent);
	}

	/* Starred pill — amber (intentionally not theme-variable; amber looks fine on both) */
	.tag-pill-star { --tag-bg: #fef9c3; --tag-text: #854d0e; }
	.tag-pill-star.tag-pill-active {
		background: #fef9c3;
		color: #854d0e;
		border-color: #d97706;
		box-shadow: 0 0 0 1.5px #d97706;
	}
	:global([data-theme="dark"]) .tag-pill-star { --tag-bg: #451a03; --tag-text: #fde68a; }
	:global([data-theme="dark"]) .tag-pill-star.tag-pill-active {
		background: #451a03;
		color: #fde68a;
		border-color: #d97706;
		box-shadow: 0 0 0 1.5px #d97706;
	}

	/* ─── Tag popover (pinned to top-right of editor-header) ── */
	/* Absolute, so it stays top-right whether tags exist or not */
	.tag-popover-wrap {
		position: absolute;
		right: 1rem;
		top: 0.45rem; /* matches editor-header padding-top */
	}

	/* Chip-style button that triggers the popover */
	.tag-chip-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		padding: 0.1rem 0.45rem;
		background: transparent;
		color: var(--text-4);
		border-radius: 999px;
		font-size: 0.7rem;
		font-weight: 500;
		border: 1px dashed var(--border-md);
		cursor: pointer;
		transition: all 0.1s;
	}
	.tag-chip-btn:hover { background: var(--bg-hover); color: var(--text-2); border-color: var(--text-4); }
	.tag-chip-btn.tag-chip-btn-active { color: var(--accent); border-color: var(--accent); }

	.tb-tag-count {
		background: var(--accent);
		color: white;
		border-radius: 999px;
		padding: 0 0.3rem;
		font-size: 0.6rem;
	}

	.tag-popover {
		position: absolute;
		right: 0;
		top: calc(100% + 4px);
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		box-shadow: var(--shadow);
		padding: 0.5rem;
		min-width: 11rem;
		z-index: 30;
	}

	.popover-label {
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--text-4);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 0.25rem;
		padding: 0 0.25rem;
	}

	.popover-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.3rem 0.25rem;
		border-radius: 0.25rem;
		cursor: pointer;
		font-size: 0.85rem;
	}
	.popover-item:hover { background: var(--bg-hover); }

	.popover-tag-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.popover-new {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin-top: 0.375rem;
		padding-top: 0.375rem;
		border-top: 1px solid var(--bg-hover);
	}

	.popover-new-input {
		flex: 1;
		border: none;
		border-bottom: 1px solid var(--border-md);
		outline: none;
		font-size: 0.8rem;
		padding: 0.15rem 0.1rem;
		background: transparent;
		color: var(--text);
	}
	.popover-new-input:focus { border-color: var(--accent); }

	.popover-add-btn {
		background: none;
		border: none;
		cursor: pointer;
		color: var(--accent);
		padding: 0.1rem;
		display: flex;
	}

	/* ─── Tag chips in the note-tags-row ────────────────── */
	.note-tag-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		padding: 0.1rem 0.45rem;
		background: var(--tag-bg, var(--bg-select));
		color: var(--tag-text, var(--accent-tx));
		border-radius: 999px;
		font-size: 0.7rem;
		font-weight: 500;
		border: none;
		cursor: pointer;
		transition: opacity 0.1s;
	}
	.note-tag-chip:hover { opacity: 0.75; }

	.title-input {
		width: 100%;
		font-size: 1.25rem;
		font-weight: 600;
		border: none;
		outline: none;
		padding: 0;
		background: transparent;
		color: var(--text);
		font-family: system-ui, -apple-system, sans-serif;
	}

	.empty-state {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		color: var(--text-4);
		gap: 1rem;
	}
	.empty-state button {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		background: var(--accent);
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

		/* Tag filter: on mobile the hover-expand is disabled (JS guard), so remove
		   the max-height clip entirely — all tags always visible, no transition */
		.filter-tags,
		.filter-tags.expanded {
			max-height: none;
			overflow-y: visible;
			transition: none;
		}

		/* On mobile the list is a full-screen page; tapping a note navigates to
		   /notes/[id] via SvelteKit routing — the editor pane is never shown here */
		.sidebar {
			width: 100%;
			min-width: unset;
			flex: 1;
			border-right: none;
			overflow: hidden;
		}

		.editor-pane { display: none; }

		/* Show the chevron button to navigate to the currently-selected note */
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
