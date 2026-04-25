<script lang="ts">
	import { onMount, tick } from 'svelte';
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
	import { api, type Note, type Tag } from '$lib/api';
	import { auth } from '$lib/stores/auth.svelte';
	import { shortcuts, matchShortcut, type ShortcutId } from '$lib/stores/shortcuts.svelte';
	import ShortcutHelp from '$lib/components/ShortcutHelp.svelte';
	import Editor, { type EditorRef } from '$lib/components/Editor.svelte';
	import { openOfflineDB, getAllNotes, getNote, getDirtyNotes, upsertNote, deleteNote as deleteOfflineNote } from '$lib/offlineDB';
	import type { CachedNote } from '$lib/offlineDB';
	import { syncOfflineChanges, type SyncTrigger } from '$lib/offlineSync';

	// PUBLIC_OFFLINE_NOTES_COUNT can be set at build time via the PUBLIC_ prefix env var.
	const OFFLINE_NOTES_COUNT = Math.max(1, parseInt(
		(import.meta.env.PUBLIC_OFFLINE_NOTES_COUNT as string | undefined) ?? '50', 10
	));
	// Heartbeat interval for pushing dirty notes to the server. Min 5 s.
	const SYNC_INTERVAL_MS = Math.max(5000, parseInt(
		(import.meta.env.PUBLIC_SYNC_INTERVAL_MS as string | undefined) ?? '30000', 10
	));

	// Lucide icons
	import {
		Bold, Italic, Underline, Quote, Code, FileCode2,
		List, ListOrdered, Minus, Undo2, Redo2, Image, Link,
		Plus, Star, Pin, Archive, Trash2, Settings, LogOut,
		ChevronRight, Search,
		CloudUpload, CheckCircle2, Lock, MoreHorizontal,
	} from 'lucide-svelte';

	let notes = $state<Note[]>([]);
	let isOnline = $state(typeof navigator !== 'undefined' ? navigator.onLine : true);
	let syncStatus = $state<'synced' | 'syncing' | 'unsynced'>('synced');
	let lastSyncAt = $state<Date | null>(null);
	let lastSyncSummary = $state<string>('');

	let selectedId = $state<number | null>(null);
	let search = $state('');
	let saving = $state(false);
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	// Helpers for detecting mobile viewport
	function isMobile() { return window.matchMedia('(max-width: 767px)').matches; }
	// Platform-aware modifier key label (⌘ on Mac, Ctrl on everything else)
	const modKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
	// Editor command ref
	let editorRef = $state<EditorRef | null>(null);
	// Title input ref (used to focus + highlight on new-note creation)
	let titleInput = $state<HTMLInputElement | null>(null);
	let searchInput = $state<HTMLInputElement | null>(null);
	let showShortcutHelp = $state(false);

	// Tags
	let allTags = $state<Tag[]>([]);
	let noteTags = $state<Tag[]>([]);
	let showTagPopover = $state(false);
	let newTagName = $state('');
	let panelNewTagName = $state('');
	let activeTagId = $state<number | null>(null);
	let starredOnly = $state(false);
	let showTagsPanel = $state(false);
	// Note action menu
	let showNoteMenu = $state(false);

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
	let tagsTabActive = $derived(activeTagId !== null);

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

	/**
	 * Merge a server-returned note list with the local IDB cache so that
	 *  - dirty notes (edited offline but not yet synced) keep their local
	 *    title/body rather than being clobbered by the older server copy, and
	 *  - offline-created notes (is_new, negative id) that the server does
	 *    not yet know about stay visible.
	 *
	 * Without this, a reload after reconnect would silently drop any unsynced
	 * local changes whenever the sync itself failed.
	 */
	async function mergeServerWithCache(serverNotes: Note[]): Promise<Note[]> {
		const db = await openOfflineDB();
		const cached = await getAllNotes(db);
		db.close();

		// Overlay dirty (but not new) local content onto matching server notes
		const dirtyById = new Map<number, CachedNote>();
		for (const c of cached) {
			if (c.is_dirty && !c.is_new) dirtyById.set(c.id, c);
		}
		const merged: Note[] = serverNotes.map((n) => {
			const d = dirtyById.get(n.id);
			if (!d) return n;
			return { ...n, title: d.title, body: d.body, updated_at: d.local_updated_at };
		});

		// Include offline-created notes (not yet on the server) — apply the
		// same filters the server query applies so the list stays consistent.
		for (const c of cached) {
			if (!c.is_new) continue;
			if (starredOnly && !c.starred) continue;
			if (activeTagId !== null && !c.tags.some((t) => t.id === activeTagId)) continue;
			if (search) {
				const term = search.toLowerCase();
				if (!c.title.toLowerCase().includes(term) && !c.body.toLowerCase().includes(term)) continue;
			}
			merged.push(cachedToNote(c));
		}

		// Re-sort: pinned first, then most recently updated.
		return merged.sort((a, b) => {
			if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
			return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
		});
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
			notes = await mergeServerWithCache(fetched);
			// Cache top-N when no filter is active (we want the canonical recent list)
			if (!search && activeTagId === null && !starredOnly) {
				cacheNotesForOffline(fetched); // fire-and-forget
			}
		} catch {
			// Network failed despite onLine — fall back to cache
			notes = await loadFromCache();
		}
	}

	/** Returns true if the note body contains markdown/HTML images. */
	function noteHasImages(body: string): boolean {
		return /!\[.*?\]\(.*?\)|<img[\s>]/i.test(body);
	}

	/**
	 * Bidirectional heartbeat:
	 *   1. Push any locally-dirty notes to the server (conflicts get preserved
	 *      as "[sync conflict]" notes).
	 *   2. Reload the notes list from the server so edits made on OTHER
	 *      devices become visible without a force-refresh. `loadNotes` then
	 *      merges the server list with the IDB cache via `mergeServerWithCache`,
	 *      so any still-dirty local edits survive.
	 *
	 * Runs both on a timer (every `SYNC_INTERVAL_MS`) and on demand (manual
	 * button, `online` event). A `trigger` is passed through to the log so
	 * the source of each run is traceable in DevTools.
	 */
	async function heartbeatSync(trigger: SyncTrigger = 'heartbeat') {
		if (!navigator.onLine) return;
		syncStatus = 'syncing';

		const result = await syncOfflineChanges(trigger);

		// If the note we had open was a temp-ID that just got a real server ID, update selection
		if (selectedId !== null) {
			const mapping = result.mappings.find((m) => m.tempId === selectedId);
			if (mapping) selectedId = mapping.serverId;
		}

		// Pull: refresh list so server-side changes (from another device, conflict notes,
		// etc.) show up. loadNotes() merges with IDB so still-dirty local edits survive.
		try {
			await loadNotes();
		} catch {
			// loadNotes already falls back to cache on network failure — swallow here.
		}

		// Finalise status from IDB — if anything remained dirty (network errors)
		// keep the "unsynced" indicator on.
		const db = await openOfflineDB();
		const stillDirty = await getDirtyNotes(db);
		db.close();
		syncStatus = stillDirty.length > 0 ? 'unsynced' : 'synced';

		lastSyncAt = new Date();
		lastSyncSummary = `pushed ${result.pushed.created + result.pushed.updated}, conflicts ${result.conflicts}, errors ${result.errors}`;
	}

	/** Manual sync — wired to the sync-status indicator in the sidebar footer. */
	async function manualSync() {
		if (!navigator.onLine) return;
		await heartbeatSync('manual');
	}

	/** Human-readable tooltip for the sync indicator. */
	let syncTooltip = $derived.by(() => {
		if (syncStatus === 'syncing') return 'Syncing…';
		if (!lastSyncAt) {
			return syncStatus === 'unsynced' ? 'Unsynced changes — click to sync' : 'Click to sync now';
		}
		const when = lastSyncAt.toLocaleTimeString();
		const state = syncStatus === 'unsynced' ? 'Unsynced changes' : 'All changes synced';
		return `${state} · last sync ${when} (${lastSyncSummary}) — click to sync now`;
	});

	/** Read dirty-note count from IndexedDB and update syncStatus (no network call). */
	async function refreshSyncStatus() {
		const db = await openOfflineDB();
		const dirty = await getDirtyNotes(db);
		db.close();
		syncStatus = dirty.length > 0 ? 'unsynced' : 'synced';
	}

	onMount(() => {
		isOnline = navigator.onLine;

		// Load per-user keyboard shortcut overrides from localStorage.
		if (auth.user?.id != null) shortcuts.load(auth.user.id);

		const handleOnline = async () => {
			isOnline = true;
			// Bidirectional sync on reconnect: push dirty, pull fresh list.
			await heartbeatSync('online');
			allTags = await api.tags.list().catch(() => allTags);
		};
		const handleOffline = () => {
			isOnline = false;
			void refreshSyncStatus();
		};
		const handleKeydown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') { showTagPopover = false; }
			const id = matchShortcut(e, { skipInInputs: true });
			if (!id) return;
			runShortcut(id, e);
		};
		window.addEventListener('online', handleOnline);
		window.addEventListener('offline', handleOffline);
		window.addEventListener('keydown', handleKeydown);

		// Periodic bidirectional sync while the page is open.
		const heartbeatTimer = setInterval(() => { void heartbeatSync('heartbeat'); }, SYNC_INTERVAL_MS);

		// Fire async init as a void IIFE so the cleanup function can be returned synchronously.
		void (async () => {
			await loadNotes();
			await refreshSyncStatus();
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
		})();

		return () => {
			window.removeEventListener('online', handleOnline);
			window.removeEventListener('offline', handleOffline);
			window.removeEventListener('keydown', handleKeydown);
			clearInterval(heartbeatTimer);
		};
	});

	function runShortcut(id: ShortcutId, e: KeyboardEvent) {
		switch (id) {
			case 'new-note':
				e.preventDefault();
				void newNote();
				break;
			case 'search-focus':
				e.preventDefault();
				searchInput?.focus();
				searchInput?.select();
				break;
			case 'help-modal':
				e.preventDefault();
				showShortcutHelp = true;
				break;
			case 'bold':
				cmd(toggleStrongCommand.key as CmdKey<unknown>);
				break;
			case 'italic':
				cmd(toggleEmphasisCommand.key as CmdKey<unknown>);
				break;
			case 'underline':
				cmd(toggleUnderlineCommand.key as CmdKey<unknown>);
				break;
			case 'insert-link':
				e.preventDefault();
				openLinkDialog();
				break;
			case 'save':
				// The editor auto-saves on blur; pressing Ctrl+Enter blurs the
				// currently-focused field so the save fires immediately.
				(document.activeElement as HTMLElement | null)?.blur();
				break;
			case 'open-tags':
				e.preventDefault();
				showTagPopover = !showTagPopover;
				break;
		}
	}

	/**
	 * Default title for a freshly-created note. Generated client-side using the
	 * user's *local* time and English weekday name, so it reads naturally no
	 * matter where the server lives (e.g. "2026-04-14 14:23:30 - Tuesday").
	 * The same format is used whether the note is created online or offline.
	 */
	function defaultNoteTitle(now: Date = new Date()): string {
		const pad = (n: number) => n.toString().padStart(2, '0');
		const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} `
			+ `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
		const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
		return `${ts} - ${weekday}`;
	}

	/** Focus and select the title input so the generated default can be overwritten. */
	async function focusTitleInput() {
		await tick();
		titleInput?.focus();
		titleInput?.select();
	}

	async function createNoteOffline() {
		const tempId = -Date.now();
		const now = new Date().toISOString();
		const title = defaultNoteTitle();
		const cached: CachedNote = {
			id: tempId, title, body: '',
			starred: false, pinned: false, tags: [],
			server_updated_at: now, local_updated_at: now,
			is_dirty: true, is_new: true,
		};
		const db = await openOfflineDB();
		await upsertNote(db, cached);
		db.close();
		const offlineNote: Note = {
			id: tempId, title, body: '',
			starred: false, pinned: false, archived: false,
			created_at: now, updated_at: now,
		};
		notes = [offlineNote, ...notes];
		selectedId = tempId;
		noteTags = [];
		if (isMobile()) { goto(`/notes/${tempId}?new=1`); return; }
		await focusTitleInput();
	}

	async function newNote() {
		if (!navigator.onLine) {
			await createNoteOffline();
			return;
		}
		try {
			const note = await api.notes.create(defaultNoteTitle());
			const firstUnpinned = notes.findIndex((n) => !n.pinned);
			if (firstUnpinned === -1) {
				notes = [...notes, note];
			} else {
				notes = [...notes.slice(0, firstUnpinned), note, ...notes.slice(firstUnpinned)];
			}
			selectedId = note.id;
			noteTags = [];
			if (isMobile()) { goto(`/notes/${note.id}?new=1`); return; }
			await focusTitleInput();
		} catch {
			// API unreachable (navigator.onLine can be true on captive portals etc.)
			await createNoteOffline();
		}
	}

	async function selectNote(id: number) {
		if (isMobile()) { goto(`/notes/${id}`); return; }
		selectedId = id;
		showTagPopover = false;
		showNoteMenu = false;
		noteTags = await api.tags.listForNote(id);
	}

	async function duplicateNote(id: number) {
		const note = notes.find(n => n.id === id);
		if (!note) return;
		showNoteMenu = false;
		const dup = await api.notes.create((note.title || 'Untitled') + ' (copy)');
		if (note.body) await api.notes.update(dup.id, { body: note.body });
		dup.body = note.body;
		const firstUnpinned = notes.findIndex(n => !n.pinned);
		notes = firstUnpinned === -1 ? [...notes, dup] : [...notes.slice(0, firstUnpinned), dup, ...notes.slice(firstUnpinned)];
		selectedId = dup.id;
	}

	function toggleTagsTab() {
		if (tagsTabActive) {
			activeTagId = null;
			showTagsPanel = false;
		} else {
			starredOnly = false;
			showTagsPanel = !showTagsPanel;
		}
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

	async function createTagFromPanel() {
		const name = panelNewTagName.trim();
		if (!name) return;
		panelNewTagName = '';
		let tag = allTags.find(t => t.name.toLowerCase() === name.toLowerCase());
		if (!tag) {
			tag = await api.tags.create(name);
		}
		if (selectedId && !noteTags.find(t => t.id === tag!.id)) {
			await api.tags.addToNote(selectedId, tag!.id);
			noteTags = [...noteTags, tag!];
		}
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
		showTagPopover = false;
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
					syncStatus = 'unsynced';
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

	function wordCount(body: string): number {
		if (!body?.trim()) return 0;
		return body
			.replace(/```[\s\S]*?```/g, ' ')
			.replace(/`[^`]*`/g, ' ')
			.replace(/!\[.*?\]\(.*?\)/g, ' ')
			.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
			.replace(/[*_#>`~\-=|[\]()]/g, ' ')
			.trim()
			.split(/\s+/)
			.filter(w => /\w/.test(w))
			.length;
	}
</script>


<svelte:head>
	<title>Crapnote</title>
</svelte:head>

<div class="app">
	<!-- ── Sidebar ── -->
	<aside class="sidebar">
		<header class="sidebar-header">
			<a href="/" class="wordmark app-name">Crapnote<span class="wordmark-dot" aria-hidden="true"></span></a>
			{#if !isOnline}
				<span class="offline-badge" title="You are offline — changes will sync when reconnected">Offline</span>
			{/if}
			{#if selectedId}
				<button class="hdr-btn mobile-show-editor" onclick={() => goto(`/notes/${selectedId}`)} title="View note" aria-label="View note">
					<ChevronRight size={18} />
				</button>
			{/if}
			<button class="hdr-btn new-btn" onclick={newNote} title="New note" aria-label="New note">
				<Plus size={16} />
			</button>
		</header>

		<div class="search-box">
			<Search size={13} />
			<input
				type="search"
				placeholder="Search {notes.length} notes"
				bind:this={searchInput}
				bind:value={search}
				oninput={handleSearch}
			/>
			<span class="search-shortcut" aria-hidden="true">{modKey}K</span>
		</div>

		<div class="pane-switcher" role="group" aria-label="Filter notes">
			<button
				class="pane-tab"
				class:pane-tab-active={!starredOnly && !showTagsPanel}
				onclick={() => { applyFilter(starredOnly ? activeTagId : null, false); showTagsPanel = false; }}
			>{tagsTabActive && !showTagsPanel ? 'Filtered' : 'All'}</button>
			<button
				class="pane-tab"
				class:pane-tab-active={starredOnly}
				onclick={() => { toggleStarFilter(); showTagsPanel = false; }}
			>Starred</button>
			{#if visibleTags.length > 0}
				<button
					class="pane-tab"
					class:pane-tab-active={showTagsPanel}
					onclick={toggleTagsTab}
				>Tags</button>
			{/if}
		</div>

		{#if tagsTabActive && !showTagsPanel}
			{@const activeTag = allTags.find(t => t.id === activeTagId)}
			{#if activeTag}
				{@const c = tagColor(activeTag)}
				<div class="filter-capsule-row">
					<span class="filter-capsule">
						<span class="filter-capsule-dot" style="background:{c.text}"></span>
						<span class="filter-capsule-name">{activeTag.name}</span>
						<button class="filter-capsule-clear" onclick={() => { applyFilter(null, starredOnly); }} aria-label="Clear filter">×</button>
					</span>
				</div>
			{/if}
		{/if}

		{#if showTagsPanel}
			<div class="tag-panel" role="group" aria-label="Tag filters">
				<p class="tag-panel-header">Filter by tag</p>
				{#each visibleTags as tag (tag.id)}
					{@const c = tagColor(tag)}
					<button
						class="tag-panel-item"
						class:tag-panel-active={activeTagId === tag.id}
						onclick={() => { applyFilter(tag.id, false); showTagsPanel = false; }}
					>
						<span class="tag-dot" style="background:{c.text}"></span>
						<span class="tag-panel-name">{tag.name}</span>
						<span class="tag-panel-count">{tag.note_count}</span>
					</button>
				{/each}
				<div class="tag-panel-new-row">
					<span class="tag-panel-new-plus" aria-hidden="true">+</span>
					<input
						class="tag-panel-new-input"
						type="text"
						placeholder="New tag…"
						bind:value={panelNewTagName}
						onkeydown={(e) => e.key === 'Enter' && createTagFromPanel()}
					/>
				</div>
			</div>
		{:else}

		<ul class="note-list" role="list" class:note-list-filtered={tagsTabActive}>
			{#each notes as note (note.id)}
				<li class="note-item" class:selected={note.id === selectedId}>
					<div class="note-btn" role="button" tabindex="0" onclick={() => selectNote(note.id)} onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && selectNote(note.id)}>
						<div class="note-row-top">
							<span class="note-title" class:untitled={!note.title}>{note.title || 'Untitled'}</span>
							<span class="note-meta-icons">
								{#if note.pinned}
									<button class="meta-icon-btn" onclick={(e) => { e.stopPropagation(); togglePin(note.id); }} title="Unpin" aria-label="Unpin"><Pin size={11} /></button>
								{/if}
								{#if note.starred}
									<button class="meta-icon-btn meta-star" onclick={(e) => { e.stopPropagation(); toggleStar(note.id); }} title="Unstar" aria-label="Unstar"><Star size={11} /></button>
								{/if}
								{#if !isOnline && noteHasImages(note.body)}
									<span title="Images unavailable offline"><Lock size={11} /></span>
								{/if}
							</span>
						</div>
						<span class="note-date">
							{new Date(note.created_at ?? note.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {new Date(note.created_at ?? note.updated_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
						</span>
					</div>
					<div class="note-hover-actions">
						{#if !note.starred}
							<button class="act-btn" onclick={() => toggleStar(note.id)} title="Star"><Star size={12} /></button>
						{/if}
						{#if !note.pinned}
							<button class="act-btn" onclick={() => togglePin(note.id)} title="Pin"><Pin size={12} /></button>
						{/if}
						<button class="act-btn" onclick={() => archiveNote(note.id)} title="Move to archive" aria-label="Move to archive"><Archive size={12} /></button>
						<button class="act-btn danger" onclick={() => deleteNote(note.id)} title="Delete"><Trash2 size={12} /></button>
					</div>
				</li>
			{/each}
			{#if notes.length === 0}
				<li class="empty">No notes yet.</li>
			{/if}
		</ul>
		{/if}

		<div class="sidebar-bottom">
			<span class="sidebar-user">{auth.user?.username ?? ''}</span>
			<div class="bottom-actions">
				<button
					type="button"
					class="bottom-btn"
					class:sync-unsynced={syncStatus === 'unsynced'}
					class:sync-syncing={syncStatus === 'syncing'}
					title={syncTooltip}
					aria-label={syncTooltip}
					disabled={syncStatus === 'syncing' || !isOnline}
					onclick={manualSync}
				>
					{#if syncStatus === 'synced'}<CheckCircle2 size={14} />{:else}<CloudUpload size={14} />{/if}
				</button>
				<a href="/archive" class="bottom-btn" title="Archive"><Archive size={15} /></a>
				<a href="/settings" class="bottom-btn" title="Settings"><Settings size={15} /></a>
				<button class="bottom-btn" onclick={handleLogout} title="Log out"><LogOut size={15} /></button>
			</div>
		</div>
	</aside>

	<!-- ── Editor pane ── -->
	<main class="editor-pane">
		{#if selectedNote}
			<div class="toolbar" role="toolbar" aria-label="Formatting">
				<button class="tb-btn" onclick={() => cmd(toggleStrongCommand.key)} title="Bold"><Bold size={13} /></button>
				<button class="tb-btn" onclick={() => cmd(toggleEmphasisCommand.key)} title="Italic"><Italic size={13} /></button>
				<button class="tb-btn" onclick={() => cmd(toggleUnderlineCommand.key)} title="Underline"><Underline size={13} /></button>
				<div class="link-btn-wrap">
					<button class="tb-btn" onclick={openLinkDialog} title="Insert link (Ctrl+K)"><Link size={13} /></button>
					{#if showLinkDialog}
						<div class="link-dialog-backdrop" onclick={() => (showLinkDialog = false)} role="presentation"></div>
						<div class="link-dialog" role="dialog" aria-label="Insert link">
							<input class="link-dialog-input" type="url" placeholder="https://…" bind:value={linkDialogHref} onkeydown={linkInputKeydown} use:focusInput />
							<button class="link-dialog-btn" onclick={applyLink}>Apply</button>
						</div>
					{/if}
				</div>
				<span class="tb-sep"></span>
				<button class="tb-btn" onclick={() => cmd(wrapInBlockquoteCommand.key)} title="Quote"><Quote size={13} /></button>
				<button class="tb-btn" onclick={() => cmd(toggleInlineCodeCommand.key)} title="Inline code"><Code size={13} /></button>
				<button class="tb-btn" onclick={() => cmd(createCodeBlockCommand.key)} title="Code block"><FileCode2 size={13} /></button>
				<span class="tb-sep"></span>
				<button class="tb-btn" onclick={() => cmd(wrapInBulletListCommand.key)} title="Bullet list"><List size={13} /></button>
				<button class="tb-btn" onclick={() => cmd(wrapInOrderedListCommand.key)} title="Numbered list"><ListOrdered size={13} /></button>
				<button class="tb-btn" onclick={() => cmd(insertHrCommand.key)} title="Horizontal rule"><Minus size={13} /></button>
				<span class="tb-sep"></span>
				<button class="tb-btn" onclick={() => cmd(undoCommand.key)} title="Undo"><Undo2 size={13} /></button>
				<button class="tb-btn" onclick={() => cmd(redoCommand.key)} title="Redo"><Redo2 size={13} /></button>
				<span class="tb-sep"></span>
				<button class="tb-btn" onclick={() => cmd(insertImageCommand.key)} title="Insert image"><Image size={13} /></button>
				<span class="tb-spacer"></span>
				<button class="tb-btn tb-star" class:tb-star-on={selectedNote.starred} onclick={() => toggleStar(selectedNote.id)} title={selectedNote.starred ? 'Unstar' : 'Star'}><Star size={13} /></button>
				<div class="note-menu-wrap">
					<button class="tb-btn" onclick={() => (showNoteMenu = !showNoteMenu)} title="More actions" aria-label="More actions"><MoreHorizontal size={13} /></button>
					{#if showNoteMenu}
						<div class="note-menu-backdrop" onclick={() => (showNoteMenu = false)} role="presentation"></div>
						<div class="note-menu" role="menu">
							<button class="note-menu-item" role="menuitem" onclick={() => { togglePin(selectedNote.id); showNoteMenu = false; }}>
								<Pin size={13} />{selectedNote.pinned ? 'Unpin note' : 'Pin note'}
							</button>
							<button class="note-menu-item" role="menuitem" onclick={() => duplicateNote(selectedNote.id)}>
								<Plus size={13} />Duplicate note
							</button>
							<button class="note-menu-item danger" role="menuitem" onclick={() => { deleteNote(selectedNote.id); showNoteMenu = false; }}>
								<Trash2 size={13} />Move to trash
							</button>
						</div>
					{/if}
				</div>
			</div>

			<div class="editor-header">
				<div class="editor-header-inner">
					<input
						bind:this={titleInput}
						class="title-input"
						type="text"
						value={selectedNote.title}
						oninput={(e) => scheduleAutoSave('title', (e.target as HTMLInputElement).value)}
						placeholder="Note title"
					/>
				</div>
			</div>

			{#key selectedId}
				<Editor value={selectedNote.body} onchange={(md) => scheduleAutoSave('body', md)} bind:ref={editorRef} oninsertlink={openLinkDialog} />
			{/key}
			{#if !isOnline && noteHasImages(selectedNote.body)}
				<div class="offline-image-notice"><Lock size={13} /> Images aren't available offline</div>
			{/if}

			<!-- Bottom status bar -->
			<div class="editor-statusbar">
				<span class="status-meta">
					{#if selectedNote.created_at}
						Created {new Date(selectedNote.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {new Date(selectedNote.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
						<span class="status-sep" aria-hidden="true">·</span>
					{/if}
					{wordCount(selectedNote.body)} words
					{#if saving}
						<span class="status-sep" aria-hidden="true">·</span>
						<span class="status-saving">Saving…</span>
					{/if}
				</span>
				<span class="status-tags">
					<span class="status-tags-label">Tags</span>
					{#each noteTags as tag (tag.id)}
						{@const c = tagColor(tag)}
						<button class="note-tag-chip" onclick={() => { const newId = activeTagId === tag.id ? null : tag.id; applyFilter(newId, starredOnly); if (newId !== null) showTagsPanel = true; }} title="Filter by {tag.name}">
							<span class="status-tag-dot" style="background:{c.text}"></span>
							<span class="status-tag-word">{tag.name}</span>
						</button>
					{/each}
					<div class="tag-popover-wrap">
						<button class="status-add-tag" onclick={() => (showTagPopover = !showTagPopover)} title="Tags">+ add tag</button>
						{#if showTagPopover}
							<div class="tag-popover-backdrop" onclick={() => (showTagPopover = false)} role="presentation"></div>
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
									<input class="popover-new-input" type="text" placeholder="New tag…" bind:value={newTagName} onkeydown={(e) => e.key === 'Enter' && createAndAddTag()} />
									<button class="popover-add-btn" onclick={createAndAddTag}><Plus size={12} /></button>
								</div>
							</div>
						{/if}
					</div>
					<span class="status-shortcut" aria-hidden="true">{shortcuts.displayCombo(shortcuts.get('open-tags'))}</span>
				</span>
			</div>
		{:else}
			<div class="empty-state">
				<p>Select a note or create a new one.</p>
				<button onclick={newNote}><Plus size={16} /> New note</button>
			</div>
		{/if}
	</main>
</div>

<ShortcutHelp open={showShortcutHelp} onclose={() => (showShortcutHelp = false)} />

<style>
	/* ─── Layout ─────────────────────────────────────────── */
	.app {
		display: flex;
		height: 100dvh;
		overflow: hidden;
		font-family: var(--sans);
	}

	/* ─── Sidebar ────────────────────────────────────────── */
	.sidebar {
		width: 300px;
		min-width: 220px;
		display: flex;
		flex-direction: column;
		border-right: 1px solid var(--border);
		background: var(--bg-alt);
		flex-shrink: 0;
		overflow: hidden;
	}

	.sidebar-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 1.25rem 1.25rem 0.75rem;
		flex-shrink: 0;
	}

	/* Wordmark */
	.wordmark {
		font-family: var(--serif);
		font-weight: 800;
		font-size: 1.5rem;
		letter-spacing: -0.04em;
		line-height: 1;
		color: var(--text);
		text-decoration: none;
		display: inline-flex;
		align-items: baseline;
		margin-right: auto;
	}
	.wordmark-dot {
		display: inline-block;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--accent);
		margin-left: 3px;
		margin-bottom: 1px;
	}

	.offline-badge {
		font-size: 0.65rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		padding: 0.1rem 0.4rem;
		background: #fef3c7;
		color: #92400e;
		border: 1px solid #fde68a;
	}

	.hdr-btn {
		background: none;
		border: none;
		cursor: pointer;
		color: var(--text-3);
		padding: 0.25rem;
		display: flex;
		align-items: center;
	}
	.hdr-btn:hover { color: var(--text); }

	.new-btn {
		width: 26px;
		height: 26px;
		border: 1px solid var(--border);
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-3);
		background: transparent;
		cursor: pointer;
		padding: 0;
	}
	.new-btn:hover { color: var(--text); border-color: var(--text-3); }

	/* Search */
	.search-box {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0 1.25rem 0.75rem;
		color: var(--text-4);
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}
	.search-box input {
		flex: 1;
		border: none;
		background: none;
		font-size: 0.8125rem;
		font-family: var(--sans);
		outline: none;
		color: var(--text);
	}
	.search-box input::placeholder { color: var(--text-4); }
	.search-shortcut {
		font-size: 0.625rem;
		color: var(--text-4);
		background: var(--bg-hover);
		border: 1px solid var(--border);
		padding: 0.1rem 0.3rem;
		border-radius: 2px;
		flex-shrink: 0;
		font-family: var(--mono);
	}

	/* Pane switcher */
	.pane-switcher {
		display: flex;
		align-items: center;
		padding: 0 1.25rem;
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}
	.pane-tab {
		font-family: var(--sans);
		font-size: 0.6875rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-4);
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		padding: 0.6rem 0;
		margin-right: 1.25rem;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
	}
	.pane-tab:last-child { margin-right: 0; }
	.pane-tab:hover { color: var(--text-2); }
	.pane-tab-active { color: var(--text) !important; border-bottom-color: var(--accent); }

	/* Filter capsule (shown below tabs when tag filter is active) */
	.filter-capsule-row {
		padding: 0.5rem 1.25rem;
		flex-shrink: 0;
	}
	.filter-capsule {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		font-family: var(--sans);
		font-size: 0.6875rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-2);
		background: var(--bg-hover);
		border: 1px solid var(--border-md);
		padding: 0.2rem 0.375rem 0.2rem 0.5rem;
	}
	.filter-capsule-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.filter-capsule-clear {
		background: none;
		border: none;
		cursor: pointer;
		color: var(--text-4);
		font-size: 1rem;
		line-height: 1;
		padding: 0 0.1rem;
		display: flex;
		align-items: center;
	}
	.filter-capsule-clear:hover { color: var(--text-2); }

	/* Tag panel (shown when Tags tab is active) */
	.tag-panel {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
	}
	.tag-panel-header {
		font-family: var(--sans);
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-4);
		padding: 0.75rem 1.25rem 0.375rem;
		margin: 0;
	}
	.tag-panel-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.4rem 1.25rem;
		font-family: var(--sans);
		font-size: 0.875rem;
		color: var(--text-2);
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
	}
	.tag-panel-item:hover { background: var(--bg-hover); }
	.tag-panel-active { color: var(--text) !important; background: var(--bg-alt) !important; }
	.tag-panel-name { flex: 1; min-width: 0; }
	.tag-panel-count {
		font-size: 0.75rem;
		color: var(--text-4);
		font-family: var(--mono);
		flex-shrink: 0;
	}
	.tag-panel-new-row {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.4rem 1.25rem 0.75rem;
		color: var(--text-4);
	}
	.tag-panel-new-plus {
		font-size: 0.875rem;
		line-height: 1;
	}
	.tag-panel-new-input {
		font-family: var(--sans);
		font-size: 0.875rem;
		color: var(--text-2);
		background: none;
		border: none;
		outline: none;
		flex: 1;
		padding: 0;
	}
	.tag-panel-new-input::placeholder { color: var(--text-4); }
	.tag-dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex-shrink: 0;
	}



	/* ─── Note list ──────────────────────────────────────── */
	.note-list {
		flex: 1;
		min-height: 0;
		overflow-y: scroll;
		overflow-x: hidden;
		list-style: none;
		margin: 0;
		padding: 0.375rem 0;
		scrollbar-gutter: stable;
		scrollbar-width: thin;
		scrollbar-color: transparent transparent;
	}
	.note-list-filtered { padding-top: 0; }
	.note-list::-webkit-scrollbar { width: 5px; }
	.note-list::-webkit-scrollbar-thumb { background: transparent; }
	.note-list::-webkit-scrollbar-track { background: transparent; }
	.note-list:hover { scrollbar-color: var(--border-md) transparent; }
	.note-list:hover::-webkit-scrollbar-thumb { background: var(--border-md); }

	.note-item {
		position: relative;
		margin-bottom: 1px;
	}
	.note-item.selected { background: var(--bg-select); box-shadow: inset 2px 0 0 var(--accent); }
	.note-item:not(.selected):hover { background: var(--bg-hover); }

	.note-btn {
		width: 100%;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		padding: 0.6875rem calc(1.25rem - 5px) 0.5rem 1.25rem;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
	}

	.note-row-top {
		display: flex;
		align-items: flex-start;
		width: 100%;
		gap: 0.375rem;
	}

	.note-title {
		flex: 1;
		font-family: var(--serif);
		font-size: 1.1rem;
		font-weight: 600;
		line-height: 1.25;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--text);
	}
	.note-title.untitled { color: var(--text-4); font-style: italic; }

	.note-meta-icons {
		display: flex;
		align-items: center;
		gap: 4px;
		color: var(--text-4);
		flex-shrink: 0;
		margin-top: 1px;
	}

	.meta-icon-btn {
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		display: inline-flex;
		color: var(--text-4);
		line-height: 1;
	}
	.meta-star { color: var(--accent); }

	.note-date {
		font-size: 0.6875rem;
		color: var(--text-4);
		font-family: var(--sans);
		font-variant-numeric: tabular-nums;
		margin-top: 0.2rem;
		padding-left: 0;
	}

	.note-hover-actions {
		display: flex;
		gap: 1px;
		padding: 0.125rem calc(1.25rem - 5px) 0.375rem 1.25rem;
		opacity: 0;
		transition: opacity 0.1s;
	}
	.note-item:hover .note-hover-actions { opacity: 1; }

	.act-btn {
		background: none;
		border: none;
		cursor: pointer;
		padding: 0.2rem 0.3rem;
		color: var(--text-4);
		display: flex;
		align-items: center;
		border-radius: 2px;
	}
	.act-btn:hover { background: var(--border); color: var(--text-2); }
	.act-btn.danger:hover { color: var(--danger); background: var(--danger-bg); }

	.empty { padding: 1.5rem 1rem; color: var(--text-4); font-size: 0.8125rem; text-align: center; }

	/* ─── Sidebar bottom ─────────────────────────────────── */
	.sidebar-bottom {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.625rem 1rem;
		border-top: 1px solid var(--border);
		flex-shrink: 0;
	}

	.sidebar-user {
		font-family: var(--sans);
		font-size: 0.75rem;
		color: var(--text-4);
	}

	.bottom-actions { display: flex; gap: 2px; align-items: center; }

	.bottom-btn {
		display: flex;
		align-items: center;
		padding: 0.3rem;
		color: var(--text-4);
		background: none;
		border: none;
		cursor: pointer;
		text-decoration: none;
		border-radius: 2px;
	}
	.bottom-btn:hover { color: var(--text-2); background: var(--bg-hover); }
	.bottom-btn:disabled { cursor: default; opacity: 0.6; }
	.sync-unsynced { color: #92400e; }

	.mobile-show-editor { display: none; }

	/* ─── Editor pane ────────────────────────────────────── */
	.editor-pane {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
		background: var(--bg);
	}

	/* ─── Toolbar ────────────────────────────────────────── */
	.toolbar {
		display: flex;
		align-items: center;
		gap: 1px;
		padding: 0.3rem 1rem;
		border-bottom: 1px solid var(--border);
		background: var(--bg-toolbar);
		flex-shrink: 0;
		flex-wrap: wrap;
	}

	.tb-btn {
		padding: 0.3rem 0.35rem;
		background: none;
		border: 1px solid transparent;
		border-radius: 2px;
		cursor: pointer;
		color: var(--text-3);
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.tb-btn:hover { background: var(--bg-hover); color: var(--text-2); }
	.tb-star-on { color: var(--accent) !important; }

	.tb-sep {
		width: 1px;
		height: 14px;
		background: var(--border);
		margin: 0 0.2rem;
		flex-shrink: 0;
	}
	.tb-spacer { flex: 1; }

	.link-btn-wrap { position: relative; display: inline-flex; }

	.link-dialog-backdrop { position: fixed; inset: 0; z-index: 49; }

	.link-dialog {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		background: var(--bg);
		border: 1px solid var(--border);
		box-shadow: var(--shadow);
		padding: 0.375rem;
		display: flex;
		gap: 0.25rem;
		z-index: 50;
		min-width: 14rem;
	}
	.link-dialog-input {
		flex: 1;
		border: 1px solid var(--border-md);
		padding: 0.25rem 0.4rem;
		font-size: 0.8rem;
		outline: none;
		min-width: 0;
		background: var(--bg);
		color: var(--text);
		font-family: var(--sans);
	}
	.link-dialog-input:focus { border-color: var(--accent); }
	.link-dialog-btn {
		background: var(--accent);
		color: white;
		border: none;
		padding: 0.25rem 0.6rem;
		font-size: 0.8rem;
		cursor: pointer;
		flex-shrink: 0;
	}

	/* ─── Note action menu ───────────────────────────────── */
	.note-menu-wrap { position: relative; }
	.note-menu-backdrop { position: fixed; inset: 0; z-index: 49; }
	.note-menu {
		position: absolute;
		top: calc(100% + 4px);
		right: 0;
		background: var(--bg-toolbar);
		border: 1px solid var(--border-md);
		box-shadow: var(--shadow);
		z-index: 50;
		min-width: 160px;
		display: flex;
		flex-direction: column;
	}
	.note-menu-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.875rem;
		font-size: 0.8125rem;
		font-family: var(--sans);
		color: var(--text);
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
	}
	.note-menu-item:hover { background: var(--bg-hover); }
	.note-menu-item.danger { color: var(--danger); }
	.note-menu-item.danger:hover { background: var(--danger-bg); }

	/* ─── Editor header (title) ─────────────────────────── */
	.editor-header {
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}
	.editor-header-inner {
		padding: 1.25rem 2rem 0.625rem;
		max-width: 760px;
		box-sizing: border-box;
	}

	.title-input {
		width: 100%;
		font-family: var(--serif);
		font-size: 2rem;
		font-weight: 700;
		letter-spacing: -0.03em;
		line-height: 1.08;
		border: none;
		outline: none;
		padding: 0;
		background: transparent;
		color: var(--text);
	}
	.title-input::placeholder { color: var(--text-4); }

	/* ─── Bottom status bar ──────────────────────────────── */
	.editor-statusbar {
		border-top: 1px solid var(--border);
		padding: 0.5rem 1.25rem;
		display: flex;
		align-items: center;
		gap: 1rem;
		font-family: var(--sans);
		font-size: 0.6875rem;
		color: var(--text-4);
		flex-shrink: 0;
		background: var(--bg-toolbar);
	}

	.status-meta {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-variant-numeric: tabular-nums;
	}
	.status-sep { opacity: 0.4; }
	.status-saving { color: var(--accent); }

	.status-tags {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 0.625rem;
	}
	.status-tags-label {
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 0.6875rem;
		color: var(--text-4);
	}
	/* Typographic tag: dot + word, no fill or border */
	.note-tag-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
	}
	.note-tag-chip:hover .status-tag-word { color: var(--text-2); }
	.status-tag-dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.status-tag-word {
		font-size: 0.8125rem;
		font-family: var(--sans);
		font-weight: 400;
		color: var(--text);
	}
	.status-shortcut {
		font-size: 0.625rem;
		color: var(--text-4);
		background: var(--bg-hover);
		border: 1px solid var(--border);
		padding: 0.1rem 0.3rem;
		border-radius: 2px;
		flex-shrink: 0;
		font-family: var(--mono);
	}

	.status-add-tag {
		background: none;
		border: none;
		cursor: pointer;
		color: var(--text-4);
		font-size: 0.6875rem;
		font-family: var(--sans);
		padding: 0;
		border-bottom: 1px dashed var(--border-md);
		line-height: 1.2;
	}
	.status-add-tag:hover { color: var(--text-2); }

	/* ─── Tag popover ────────────────────────────────────── */
	.tag-popover-backdrop { position: fixed; inset: 0; z-index: 29; }
	.tag-popover-wrap { position: relative; }

	.tag-popover {
		position: absolute;
		right: 0;
		bottom: calc(100% + 6px);
		background: var(--bg);
		border: 1px solid var(--border);
		box-shadow: var(--shadow);
		padding: 0.5rem;
		min-width: 11rem;
		z-index: 30;
	}
	.popover-label {
		font-size: 0.625rem;
		font-weight: 600;
		color: var(--text-4);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		margin: 0 0 0.25rem;
		padding: 0 0.25rem;
		font-family: var(--sans);
	}
	.popover-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.3rem 0.25rem;
		cursor: pointer;
		font-size: 0.8125rem;
		font-family: var(--sans);
		color: var(--text);
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
		border-top: 1px solid var(--border);
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
		font-family: var(--sans);
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

	.offline-image-notice {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.75rem;
		color: var(--text-4);
		padding: 0.4rem 1rem;
		border-top: 1px solid var(--border);
		font-family: var(--sans);
	}

	.empty-state {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		color: var(--text-4);
		gap: 1rem;
		font-family: var(--sans);
	}
	.empty-state p { font-size: 0.875rem; }
	.empty-state button {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		background: var(--accent);
		color: white;
		border: none;
		cursor: pointer;
		font-size: 0.875rem;
		font-family: var(--sans);
	}

	/* ─── Mobile (<= 767px) ──────────────────────────────── */
	@media (max-width: 767px) {
		.app { flex-direction: column; height: 100dvh; }
		.sidebar { width: 100%; min-width: unset; flex: 1; border-right: none; overflow: hidden; }
		.editor-pane { display: none; }
		.mobile-show-editor { display: flex; }
		.sidebar-header { padding: 0.875rem 1rem 0.5rem; }
		.note-item { margin: 0 0 1px; }
		.note-hover-actions { opacity: 1; }
		.act-btn { padding: 0.375rem 0.5rem; }
		.note-btn { padding: 0.75rem 1.25rem 0.375rem; }
	}
</style>
