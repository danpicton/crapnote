<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import {
		toggleStrongCommand,
		toggleEmphasisCommand,
		toggleInlineCodeCommand,
		wrapInBlockquoteCommand,
		wrapInBulletListCommand,
		wrapInOrderedListCommand,
		wrapInHeadingCommand,
		insertHrCommand,
		createCodeBlockCommand,
		toggleLinkCommand,
	} from '@milkdown/kit/preset/commonmark';
	import { undoCommand, redoCommand } from '@milkdown/kit/plugin/history';
	import { toggleUnderlineCommand } from '$lib/milkdown/underline';
	import type { CmdKey } from '@milkdown/kit/core';
	import { api, type Note, type Tag } from '$lib/api';
	import Editor, { type EditorRef } from '$lib/components/Editor.svelte';
	import { openOfflineDB, getNote as getOfflineNote, upsertNote } from '$lib/offlineDB';
	import {
		Bold, Italic, Underline, Quote, Code, FileCode2,
		List, ListOrdered, ListTodo, Minus, Undo2, Redo2, Link,
		Plus, ChevronLeft, Tag as TagIcon,
		Star, Pin, Archive, Trash2, MoreHorizontal, RefreshCw, X,
	} from 'lucide-svelte';
	import { wrapInTaskListCommand } from '$lib/milkdown/tasklist';

	const noteId = $derived(Number($page.params.id));

	let note = $state<Note | null>(null);
	let noteTags = $state<Tag[]>([]);
	let allTags = $state<Tag[]>([]);
	let saving = $state(false);
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let editorRef = $state<EditorRef | null>(null);
	let titleInput = $state<HTMLInputElement | null>(null);
	let showTagPopover = $state(false);
	let newTagName = $state('');
	let visibleTags = $derived(allTags.filter(t => t.note_count > 0));

	// Mobile-specific state
	let showActionSheet = $state(false);
	let showTagSheet = $state(false);
	let editorFocused = $state(false);
	let showMobHeadingMenu = $state(false);

	async function mobToggleStar() {
		if (!note) return;
		const updated = await api.notes.toggleStar(noteId);
		note = updated;
	}

	async function mobTogglePin() {
		if (!note) return;
		const updated = await api.notes.togglePin(noteId);
		note = updated;
		showActionSheet = false;
	}

	async function mobArchive() {
		if (!note) return;
		await api.notes.archive(noteId);
		showActionSheet = false;
		goto('/');
	}

	async function mobDelete() {
		showActionSheet = false;
		await api.notes.delete(noteId);
		goto('/');
	}

	async function mobForceSync() {
		showActionSheet = false;
		// Fire-and-forget — sync is managed by the main list page
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

	// Same palette + hash as the main notes list so tag colours are consistent
	const PALETTE = [
		{ bg: '#fee2e2', text: '#991b1b' },
		{ bg: '#fce7f3', text: '#831843' },
		{ bg: '#ffe4e6', text: '#881337' },
		{ bg: '#fecdd3', text: '#9f1239' },
		{ bg: '#ffedd5', text: '#9a3412' },
		{ bg: '#fef3c7', text: '#78350f' },
		{ bg: '#fef9c3', text: '#854d0e' },
		{ bg: '#ecfccb', text: '#365314' },
		{ bg: '#dcfce7', text: '#166534' },
		{ bg: '#d1fae5', text: '#064e3b' },
		{ bg: '#ccfbf1', text: '#134e4a' },
		{ bg: '#cffafe', text: '#164e63' },
		{ bg: '#e0f2fe', text: '#0c4a6e' },
		{ bg: '#dbeafe', text: '#1e3a8a' },
		{ bg: '#e0e7ff', text: '#3730a3' },
		{ bg: '#ede9fe', text: '#4c1d95' },
		{ bg: '#f3e8ff', text: '#6b21a8' },
		{ bg: '#fae8ff', text: '#86198f' },
		{ bg: '#fecaca', text: '#7f1d1d' },
		{ bg: '#fbcfe8', text: '#9d174d' },
		{ bg: '#fda4af', text: '#881337' },
		{ bg: '#fed7aa', text: '#7c2d12' },
		{ bg: '#fde68a', text: '#78350f' },
		{ bg: '#bbf7d0', text: '#14532d' },
		{ bg: '#99f6e4', text: '#134e4a' },
		{ bg: '#bae6fd', text: '#0c4a6e' },
		{ bg: '#bfdbfe', text: '#1e40af' },
		{ bg: '#c7d2fe', text: '#3730a3' },
		{ bg: '#ddd6fe', text: '#5b21b6' },
		{ bg: '#e9d5ff', text: '#6b21a8' },
		{ bg: '#f5d0fe', text: '#86198f' },
		{ bg: '#a7f3d0', text: '#064e3b' },
	] as const;

	function tagColor(tag: Tag) {
		return PALETTE[Math.imul(tag.id, 0x9e3779b9) >>> 27];
	}

	/**
	 * When the list view navigates here after creating a note, it appends
	 * `?new=1`. We honour it by focusing and selecting the title input so the
	 * generated default (e.g. "2026-04-14 14:23:30 - Tuesday") can be typed
	 * straight over without an extra tap.
	 */
	async function maybeFocusTitleForNewNote() {
		const isNew = $page.url.searchParams.get('new') === '1';
		if (!isNew) return;
		await tick();
		titleInput?.focus();
		titleInput?.select();
	}

	onMount(async () => {
		// Negative IDs are offline-created temp notes — load directly from cache
		if (noteId < 0 || !navigator.onLine) {
			const db = await openOfflineDB();
			const cached = await getOfflineNote(db, noteId);
			db.close();
			if (cached) {
				note = {
					id: cached.id, title: cached.title, body: cached.body,
					starred: cached.starred, pinned: cached.pinned, archived: false,
					created_at: cached.server_updated_at, updated_at: cached.local_updated_at,
				};
				noteTags = (cached.tags ?? []) as Tag[];
				allTags = (cached.tags ?? []) as Tag[];
				await maybeFocusTitleForNewNote();
				return;
			}
			// Fall through to try the API anyway (might be a positive ID with connectivity)
		}
		try {
			const [serverNote, fetchedTags, allTagsList] = await Promise.all([
				api.notes.get(noteId),
				api.tags.listForNote(noteId),
				api.tags.list(),
			]);
			// If the local cache has unsynced edits for this note, keep them —
			// otherwise a reconnect would silently discard the user's offline work.
			const db = await openOfflineDB();
			const cached = await getOfflineNote(db, noteId);
			db.close();
			if (cached && cached.is_dirty && !cached.is_new) {
				note = {
					...serverNote,
					title: cached.title,
					body: cached.body,
					updated_at: cached.local_updated_at,
				};
			} else {
				note = serverNote;
			}
			noteTags = fetchedTags;
			allTags = allTagsList;
			await maybeFocusTitleForNewNote();
		} catch {
			// API unavailable — try the offline cache
			const db = await openOfflineDB();
			const cached = await getOfflineNote(db, noteId);
			db.close();
			if (cached) {
				note = {
					id: cached.id, title: cached.title, body: cached.body,
					starred: cached.starred, pinned: cached.pinned, archived: false,
					created_at: cached.server_updated_at, updated_at: cached.local_updated_at,
				};
				noteTags = (cached.tags ?? []) as Tag[];
				allTags = (cached.tags ?? []) as Tag[];
				await maybeFocusTitleForNewNote();
			}
		}
	});

	function scheduleAutoSave(field: 'title' | 'body', value: string) {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(async () => {
			saving = true;
			try {
				if (!navigator.onLine || noteId < 0) {
					// Save to IndexedDB and mark dirty
					const db = await openOfflineDB();
					const existing = await getOfflineNote(db, noteId);
					if (existing) {
						await upsertNote(db, {
							...existing,
							[field]: value,
							local_updated_at: new Date().toISOString(),
							is_dirty: true,
						});
					}
					db.close();
					if (note) note = { ...note, [field]: value };
				} else {
					try {
						const updated = await api.notes.update(noteId, { [field]: value });
						note = updated;
						// Keep cache in sync
						const db = await openOfflineDB();
						const existing = await getOfflineNote(db, noteId);
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
						// Lost connectivity — save offline
						const db = await openOfflineDB();
						const existing = await getOfflineNote(db, noteId);
						if (existing) {
							await upsertNote(db, {
								...existing,
								[field]: value,
								local_updated_at: new Date().toISOString(),
								is_dirty: true,
							});
						}
						db.close();
						if (note) note = { ...note, [field]: value };
					}
				}
			} finally {
				saving = false;
			}
		}, 800);
	}

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

	async function toggleTag(tag: Tag) {
		const has = noteTags.find(t => t.id === tag.id);
		if (has) {
			await api.tags.removeFromNote(noteId, tag.id);
			noteTags = noteTags.filter(t => t.id !== tag.id);
		} else {
			await api.tags.addToNote(noteId, tag.id);
			noteTags = [...noteTags, tag];
		}
		allTags = await api.tags.list();
	}

	async function createAndAddTag() {
		if (!newTagName.trim()) return;
		const name = newTagName.trim();
		let tag = allTags.find(t => t.name.toLowerCase() === name.toLowerCase());
		if (!tag) {
			tag = await api.tags.create(name);
		}
		if (!noteTags.find(t => t.id === tag!.id)) {
			await api.tags.addToNote(noteId, tag.id);
			noteTags = [...noteTags, tag];
		}
		newTagName = '';
		allTags = await api.tags.list();
	}
</script>

<svelte:head>
	<title>{note?.title || 'Note'} — Crapnote</title>
</svelte:head>

{#if note}
<div
	class="note-page"
	onfocusin={() => (editorFocused = true)}
	onfocusout={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) editorFocused = false; }}
>
	<!-- ── Desktop toolbar (top) ─────────────────────────── -->
	<div class="toolbar desk-toolbar" role="toolbar" aria-label="Formatting">
		<button class="tb-btn" onclick={() => goto('/')} title="Back to notes" aria-label="Back to notes">
			<ChevronLeft size={16} />
		</button>
		<span class="tb-sep"></span>
		<button class="tb-btn" onclick={() => cmd(toggleStrongCommand.key)} title="Bold"><Bold size={14} /></button>
		<button class="tb-btn" onclick={() => cmd(toggleEmphasisCommand.key)} title="Italic"><Italic size={14} /></button>
		<button class="tb-btn" onclick={() => cmd(toggleUnderlineCommand.key)} title="Underline"><Underline size={14} /></button>
		<div class="link-btn-wrap">
			<button class="tb-btn" onclick={openLinkDialog} title="Insert link (Ctrl+K)"><Link size={14} /></button>
			{#if showLinkDialog}
				<div class="link-dialog-backdrop" onclick={() => (showLinkDialog = false)} role="presentation"></div>
				<div class="link-dialog" role="dialog" aria-label="Insert link">
					<input class="link-dialog-input" type="url" placeholder="https://…" bind:value={linkDialogHref} onkeydown={linkInputKeydown} use:focusInput />
					<button class="link-dialog-btn" onclick={applyLink}>Apply</button>
				</div>
			{/if}
		</div>
		<span class="tb-sep"></span>
		<button class="tb-btn" onclick={() => cmd(wrapInBlockquoteCommand.key)} title="Quote"><Quote size={14} /></button>
		<button class="tb-btn" onclick={() => cmd(toggleInlineCodeCommand.key)} title="Inline code"><Code size={14} /></button>
		<button class="tb-btn" onclick={() => cmd(createCodeBlockCommand.key)} title="Code block"><FileCode2 size={14} /></button>
		<span class="tb-sep"></span>
		<button class="tb-btn" onclick={() => cmd(wrapInBulletListCommand.key)} title="Bullet list"><List size={14} /></button>
		<button class="tb-btn" onclick={() => cmd(wrapInOrderedListCommand.key)} title="Numbered list"><ListOrdered size={14} /></button>
		<button class="tb-btn" onclick={() => cmd(insertHrCommand.key)} title="Horizontal rule"><Minus size={14} /></button>
		<span class="tb-sep"></span>
		<button class="tb-btn" onclick={() => cmd(undoCommand.key)} title="Undo"><Undo2 size={14} /></button>
		<button class="tb-btn" onclick={() => cmd(redoCommand.key)} title="Redo"><Redo2 size={14} /></button>
		<span class="tb-spacer"></span>
		<span class="save-status">{saving ? 'Saving…' : ''}</span>
	</div>

	<!-- ── Mobile top bar ───────────────────────────────── -->
	<div class="mob-topbar">
		<a href="/" class="mob-topbar-btn" aria-label="Back to notes">
			<ChevronLeft size={20} />
		</a>
		<span class="mob-topbar-spacer"></span>
		<button
			class="mob-topbar-btn"
			class:mob-star-on={note.starred}
			onclick={mobToggleStar}
			aria-label={note.starred ? 'Unstar note' : 'Star note'}
		>
			<Star size={20} aria-hidden="true" />
		</button>
		<button class="mob-topbar-btn" onclick={() => (showActionSheet = true)} aria-label="Note actions">
			<MoreHorizontal size={20} aria-hidden="true" />
		</button>
	</div>

	<!-- ── Editor header (title + tags) ─────────────────── -->
	<div class="editor-header">
		<!-- Mobile: title then tags below -->
		<input
			bind:this={titleInput}
			class="title-input"
			type="text"
			value={note.title}
			oninput={(e) => scheduleAutoSave('title', (e.target as HTMLInputElement).value)}
			placeholder="Note title"
		/>
		<!-- Mobile tag chips -->
		<div class="mob-tag-chips">
			{#each noteTags as tag (tag.id)}
				<span class="mob-tag-chip" aria-label={tag.name}>{tag.name}</span>
			{/each}
			<button class="mob-tag-add-chip" onclick={() => (showTagSheet = true)} aria-label="Add tag">
				+ tag
			</button>
		</div>
		<!-- Desktop tag popover -->
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
						<input class="popover-new-input" type="text" placeholder="New tag…" bind:value={newTagName} onkeydown={(e) => e.key === 'Enter' && createAndAddTag()} />
						<button class="popover-add-btn" onclick={createAndAddTag}><Plus size={12} /></button>
					</div>
				</div>
			{/if}
		</div>
		<!-- Desktop tag chips row (above title) -->
		{#if noteTags.length > 0}
			<div class="note-tags-chips desk-only">
				{#each noteTags as tag (tag.id)}
					{@const c = tagColor(tag)}
					<span class="note-tag-chip" style="--tag-bg:{c.bg};--tag-text:{c.text}">
						<TagIcon size={9} />{tag.name}
					</span>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Editor body -->
	<div class="editor-body">
		{#key noteId}
			<Editor
				value={note.body}
				onchange={(md) => scheduleAutoSave('body', md)}
				bind:ref={editorRef}
				oninsertlink={openLinkDialog}
			/>
		{/key}

		<!-- Mobile footer: date + word count -->
		<div class="mob-editor-footer">
			<span>
				{#if note.created_at}
					{new Date(note.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ·
					{new Date(note.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
				{/if}
			</span>
			<span>{wordCount(note.body)} words · {saving ? 'saving…' : 'saved'}</span>
		</div>
	</div>

	<!-- ── Mobile format toolbar (above keyboard, shown when focused) ── -->
	<div class="mob-format-bar" class:mob-format-bar-visible={editorFocused} role="toolbar" aria-label="Formatting" onmousedown={(e) => e.preventDefault()} onpointerdown={(e) => e.preventDefault()}>
		<div class="mob-toolbar-scroll">
			<!-- Heading -->
			<div class="mob-tb-wrap">
				<button class="mob-tb-btn" onclick={() => (showMobHeadingMenu = !showMobHeadingMenu)} aria-label="Headings" aria-expanded={showMobHeadingMenu}>H</button>
				{#if showMobHeadingMenu}
					<div class="mob-heading-backdrop" onclick={() => (showMobHeadingMenu = false)} role="presentation"></div>
					<div class="mob-heading-menu">
						{#each [1,2,3] as level}
							<button class="mob-tb-btn" onclick={() => { cmd(wrapInHeadingCommand.key as CmdKey<unknown>, level); showMobHeadingMenu = false; }} aria-label="Heading {level}">H{level}</button>
						{/each}
					</div>
				{/if}
			</div>
			<button class="mob-tb-btn" onclick={() => cmd(toggleStrongCommand.key)} aria-label="Bold"><Bold size={20} /></button>
			<button class="mob-tb-btn" onclick={() => cmd(toggleEmphasisCommand.key)} aria-label="Italic"><Italic size={20} /></button>
			<button class="mob-tb-btn" onclick={() => cmd(toggleUnderlineCommand.key)} aria-label="Underline"><Underline size={20} /></button>
			<button class="mob-tb-btn" onclick={openLinkDialog} aria-label="Insert link"><Link size={20} /></button>
			<button class="mob-tb-btn" onclick={() => cmd(wrapInBlockquoteCommand.key)} aria-label="Quote"><Quote size={20} /></button>
			<button class="mob-tb-btn" onclick={() => cmd(toggleInlineCodeCommand.key)} aria-label="Inline code"><Code size={20} /></button>
			<button class="mob-tb-btn" onclick={() => cmd(wrapInBulletListCommand.key)} aria-label="Bullet list"><List size={20} /></button>
			<button class="mob-tb-btn" onclick={() => cmd(wrapInOrderedListCommand.key)} aria-label="Ordered list"><ListOrdered size={20} /></button>
			<button class="mob-tb-btn" onclick={() => cmd(wrapInTaskListCommand.key)} aria-label="Checklist"><ListTodo size={20} /></button>
			<button class="mob-tb-btn" onclick={() => cmd(insertHrCommand.key)} aria-label="Horizontal rule"><Minus size={20} /></button>
			<button class="mob-tb-btn" onclick={() => cmd(undoCommand.key)} aria-label="Undo"><Undo2 size={20} /></button>
			<button class="mob-tb-btn" onclick={() => cmd(redoCommand.key)} aria-label="Redo"><Redo2 size={20} /></button>
		</div>
	</div>

	<!-- ── Mobile link dialog ────────────────────────────── -->
	{#if showLinkDialog}
		<div class="link-dialog-backdrop" onclick={() => (showLinkDialog = false)} role="presentation"></div>
		<div class="mob-link-dialog" role="dialog" aria-label="Insert link">
			<input class="mob-link-input" type="url" placeholder="https://…" bind:value={linkDialogHref} onkeydown={linkInputKeydown} use:focusInput />
			<button class="mob-link-btn" onclick={applyLink}>Apply</button>
		</div>
	{/if}

	<!-- ── Mobile action sheet (⋯ menu) ─────────────────── -->
	{#if showActionSheet}
		<div class="mob-sheet-backdrop" onclick={() => (showActionSheet = false)} role="presentation"></div>
		<div class="mob-sheet" role="dialog" aria-label="Note actions">
			<div class="mob-sheet-handle" aria-hidden="true"></div>
			<p class="mob-sheet-title">Note actions</p>
			<button class="mob-sheet-row" onclick={mobTogglePin}>
				<Pin size={18} aria-hidden="true" />
				<span>{note.pinned ? 'Unpin from top' : 'Pin to top'}</span>
			</button>
			<button class="mob-sheet-row" onclick={() => { mobToggleStar(); showActionSheet = false; }}>
				<Star size={18} aria-hidden="true" />
				<span>{note.starred ? 'Unstar' : 'Star'}</span>
			</button>
			<button class="mob-sheet-row" onclick={() => { showActionSheet = false; showTagSheet = true; }}>
				<TagIcon size={18} aria-hidden="true" />
				<span>Edit tags</span>
			</button>
			<button class="mob-sheet-row" onclick={mobArchive}>
				<Archive size={18} aria-hidden="true" />
				<span>Archive</span>
			</button>
			<button class="mob-sheet-row" onclick={mobForceSync}>
				<RefreshCw size={18} aria-hidden="true" />
				<span>Force sync</span>
			</button>
			<button class="mob-sheet-row mob-sheet-danger" onclick={mobDelete}>
				<Trash2 size={18} aria-hidden="true" />
				<span>Delete</span>
			</button>
		</div>
	{/if}

	<!-- ── Mobile tag sheet ──────────────────────────────── -->
	{#if showTagSheet}
		<div class="mob-sheet-backdrop" onclick={() => (showTagSheet = false)} role="presentation"></div>
		<div class="mob-sheet" role="dialog" aria-label="Tags">
			<div class="mob-sheet-handle" aria-hidden="true"></div>
			<p class="mob-sheet-title">Tags</p>
			<div class="mob-tag-sheet-body">
				<!-- Current tags -->
				{#if noteTags.length > 0}
					<div class="mob-tag-current-row">
						{#each noteTags as tag (tag.id)}
							<span class="mob-tag-current-chip">
								{tag.name}
								<button class="mob-tag-remove" onclick={() => toggleTag(tag)} aria-label="Remove {tag.name}">
									<X size={12} aria-hidden="true" />
								</button>
							</span>
						{/each}
					</div>
				{/if}
				<!-- Suggested tags -->
				{#if visibleTags.filter(t => !noteTags.find(n => n.id === t.id)).length > 0}
					<p class="mob-tag-section-label">SUGGESTED</p>
					<div class="mob-tag-suggested-row">
						{#each visibleTags.filter(t => !noteTags.find(n => n.id === t.id)) as tag (tag.id)}
							<button class="mob-tag-suggested-chip" onclick={() => toggleTag(tag)}>
								{tag.name}
							</button>
						{/each}
					</div>
				{/if}
				<!-- New tag input -->
				<div class="mob-tag-new-row">
					<span class="mob-tag-new-hash" aria-hidden="true">#</span>
					<input class="mob-tag-new-input" type="text" placeholder="New tag…" bind:value={newTagName} onkeydown={(e) => e.key === 'Enter' && createAndAddTag()} />
					<button class="mob-tag-new-add" onclick={createAndAddTag} aria-label="Add tag">
						<Plus size={16} aria-hidden="true" />
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>
{:else}
<div class="loading">Loading…</div>
{/if}

<style>
	.note-page {
		display: flex;
		flex-direction: column;
		height: 100dvh;
		background: var(--bg);
	}

	.loading {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100dvh;
		color: var(--text-4);
		font-size: 0.875rem;
	}

	/* ─── Toolbar ──────────────────────────────── */
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

	/* ─── Editor header ────────────────────────── */
	.editor-header {
		position: relative;
		padding: 0.45rem 5rem 0.45rem 1rem;
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}

	.note-tags-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin-bottom: 0.3rem;
	}

	.note-tag-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		padding: 0.1rem 0.45rem;
		background: var(--tag-bg, #e0e7ff);
		color: var(--tag-text, #4338ca);
		border-radius: 999px;
		font-size: 0.7rem;
		font-weight: 500;
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
		color: var(--text);
	}

	/* ─── Tag popover ──────────────────────────── */
	.tag-popover-wrap {
		position: absolute;
		top: 0.45rem;
		right: 1rem;
	}

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
	.tag-chip-btn-active { color: var(--accent); border-color: var(--accent); }

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

	/* ─── Shared elements ──────────────────────────── */
	.editor-body {
		flex: 1;
		min-height: 0;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	/* Hide mobile elements on desktop */
	.mob-topbar { display: none; }
	.mob-tag-chips { display: none; }
	.mob-format-bar { display: none; }
	.mob-editor-footer { display: none; }
	.mob-sheet { display: none; }
	.mob-sheet-backdrop { display: none; }
	.mob-link-dialog { display: none; }

	/* ─── Mobile (<= 640px) ────────────────────────── */
	@media (max-width: 640px) {
		/* Hide desktop toolbar */
		.desk-toolbar { display: none; }
		/* Hide desktop-only tag chips */
		.desk-only { display: none !important; }
		/* Hide desktop tag popover trigger */
		.tag-popover-wrap { display: none; }

		.note-page {
			display: flex;
			flex-direction: column;
			height: 100dvh;
			overflow: hidden;
		}

		/* Mobile top bar */
		.mob-topbar {
			display: flex;
			align-items: center;
			padding: 54px 8px 10px;
			border-bottom: 1px solid var(--border);
			flex-shrink: 0;
		}
		.mob-topbar-spacer { flex: 1; }
		.mob-topbar-btn {
			width: 44px;
			height: 44px;
			display: flex;
			align-items: center;
			justify-content: center;
			background: none;
			border: none;
			cursor: pointer;
			color: var(--text-3);
			text-decoration: none;
			border-radius: 8px;
		}
		.mob-topbar-btn:hover { color: var(--text); }
		.mob-star-on { color: var(--text-3); }

		/* Editor header */
		.editor-header {
			padding: 20px 22px 8px;
			border-bottom: 1px solid var(--border);
			position: relative;
		}
		.title-input {
			font-size: 28px;
			font-weight: 700;
			letter-spacing: -0.4px;
			line-height: 1.15;
			width: 100%;
		}

		/* Mobile tag chips below title */
		.mob-tag-chips {
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
			margin-top: 8px;
		}
		.mob-tag-chip {
			font-family: var(--sans);
			font-size: 12px;
			font-weight: 600;
			padding: 4px 10px;
			border-radius: 999px;
			background: var(--accent-lt);
			color: var(--accent);
		}
		.mob-tag-add-chip {
			font-family: var(--sans);
			font-size: 12px;
			font-weight: 600;
			padding: 4px 10px;
			border-radius: 999px;
			background: none;
			border: 1px dashed var(--border);
			color: var(--text-3);
			cursor: pointer;
		}
		.mob-tag-add-chip:hover { border-color: var(--text-3); color: var(--text-2); }

		/* Editor body — fill remaining space, hide scrollbar */
		.editor-body {
			flex: 1;
			min-height: 0;
			overflow: hidden;
			display: flex;
			flex-direction: column;
		}
		.editor-body :global(.milkdown),
		.editor-body :global(.milkdown-root),
		.editor-body :global(.ProseMirror) {
			overflow-y: auto;
			scrollbar-width: none;
			flex: 1;
			padding: 4px 22px 24px;
			font-size: 17px;
			line-height: 1.55;
		}
		.editor-body :global(*::-webkit-scrollbar) { display: none; }

		/* Mobile footer */
		.mob-editor-footer {
			display: flex;
			align-items: center;
			justify-content: space-between;
			font-family: var(--sans);
			font-size: 11px;
			color: var(--text-3);
			letter-spacing: 0.3px;
			padding: 8px 22px;
			border-top: 1px solid var(--border);
			flex-shrink: 0;
		}

		/* Mobile format toolbar */
		.mob-format-bar {
			display: flex;
			flex-shrink: 0;
			border-top: 1px solid var(--border);
			background: var(--bg-alt);
			overflow: hidden;
			max-height: 0;
			transition: max-height 200ms ease-out;
		}
		.mob-format-bar-visible {
			max-height: 54px;
		}
		.mob-toolbar-scroll {
			display: flex;
			align-items: center;
			overflow-x: auto;
			scrollbar-width: none;
			padding: 0 4px;
		}
		.mob-toolbar-scroll::-webkit-scrollbar { display: none; }

		.mob-tb-wrap { position: relative; display: inline-flex; }
		.mob-tb-btn {
			width: 42px;
			height: 42px;
			flex-shrink: 0;
			display: flex;
			align-items: center;
			justify-content: center;
			background: none;
			border: none;
			border-radius: 9px;
			cursor: pointer;
			color: var(--text-2);
			font-family: var(--serif);
			font-weight: 700;
			font-size: 15px;
		}
		.mob-tb-btn:hover { background: var(--bg-hover); }
		.mob-heading-backdrop { position: fixed; inset: 0; z-index: 49; }
		.mob-heading-menu {
			position: absolute;
			bottom: calc(100% + 4px);
			left: 0;
			background: var(--bg-alt);
			border: 1px solid var(--border);
			border-radius: 8px;
			box-shadow: var(--shadow);
			display: flex;
			z-index: 50;
			padding: 4px;
			gap: 2px;
		}

		/* Mobile link dialog */
		.mob-link-dialog {
			display: flex;
			position: fixed;
			bottom: 0;
			left: 0;
			right: 0;
			padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px));
			background: var(--bg-alt);
			border-top: 1px solid var(--border);
			gap: 8px;
			z-index: 60;
		}
		.mob-link-input {
			flex: 1;
			border: 1px solid var(--border-md);
			border-radius: 10px;
			padding: 10px 14px;
			font-size: 16px;
			background: var(--bg);
			color: var(--text);
			font-family: var(--sans);
			outline: none;
			min-width: 0;
		}
		.mob-link-input:focus { border-color: var(--accent); }
		.mob-link-btn {
			padding: 10px 18px;
			background: var(--accent);
			color: white;
			border: none;
			border-radius: 10px;
			font-size: 16px;
			font-weight: 600;
			font-family: var(--sans);
			cursor: pointer;
			white-space: nowrap;
		}

		/* Sheets (action + tag) */
		.mob-sheet-backdrop {
			display: block;
			position: fixed;
			inset: 0;
			background: rgba(0, 0, 0, 0.32);
			z-index: 70;
		}
		.mob-sheet {
			display: flex;
			flex-direction: column;
			position: fixed;
			bottom: 0;
			left: 0;
			right: 0;
			background: var(--bg-alt);
			border-radius: 18px 18px 0 0;
			padding: 12px 0 calc(16px + env(safe-area-inset-bottom, 0px));
			z-index: 71;
			max-height: 70vh;
			overflow-y: auto;
		}
		.mob-sheet-handle {
			width: 40px;
			height: 4px;
			background: var(--border);
			border-radius: 2px;
			margin: 0 auto 12px;
			flex-shrink: 0;
		}
		.mob-sheet-title {
			font-family: var(--serif);
			font-size: 18px;
			font-weight: 700;
			color: var(--text);
			margin: 0 0 8px;
			padding: 0 20px;
		}
		.mob-sheet-row {
			display: flex;
			align-items: center;
			gap: 14px;
			padding: 14px 20px;
			border: none;
			border-bottom: 1px solid var(--border);
			background: none;
			cursor: pointer;
			font-family: var(--sans);
			font-size: 16px;
			color: var(--text-2);
			text-align: left;
			width: 100%;
		}
		.mob-sheet-row:hover { background: var(--bg-hover); }
		.mob-sheet-row:last-child { border-bottom: none; }
		.mob-sheet-danger { color: var(--danger); }

		/* Tag sheet body */
		.mob-tag-sheet-body { padding: 6px 18px 12px; }
		.mob-tag-current-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
		.mob-tag-current-chip {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			font-family: var(--sans);
			font-size: 14px;
			font-weight: 600;
			padding: 8px 14px;
			border-radius: 999px;
			background: var(--accent-lt);
			color: var(--accent);
		}
		.mob-tag-remove {
			display: flex;
			align-items: center;
			background: none;
			border: none;
			cursor: pointer;
			color: var(--accent);
			padding: 0;
		}
		.mob-tag-section-label {
			font-family: var(--sans);
			font-size: 11px;
			font-weight: 600;
			color: var(--text-3);
			letter-spacing: 1px;
			text-transform: uppercase;
			margin: 0 0 8px;
		}
		.mob-tag-suggested-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
		.mob-tag-suggested-chip {
			font-family: var(--sans);
			font-size: 14px;
			padding: 8px 14px;
			border-radius: 999px;
			background: var(--bg-hover);
			color: var(--text-2);
			border: 1px solid var(--border);
			cursor: pointer;
		}
		.mob-tag-suggested-chip:hover { border-color: var(--accent); color: var(--accent); }
		.mob-tag-new-row {
			display: flex;
			align-items: center;
			gap: 8px;
			background: var(--bg-hover);
			border: 1px solid var(--border);
			border-radius: 12px;
			padding: 12px 14px;
		}
		.mob-tag-new-hash { font-size: 16px; color: var(--text-3); font-family: var(--sans); }
		.mob-tag-new-input {
			flex: 1;
			border: none;
			background: none;
			font-size: 16px;
			font-family: var(--sans);
			color: var(--text);
			outline: none;
		}
		.mob-tag-new-input::placeholder { color: var(--text-3); }
		.mob-tag-new-add {
			width: 32px;
			height: 32px;
			border-radius: 999px;
			background: var(--accent);
			border: none;
			cursor: pointer;
			display: flex;
			align-items: center;
			justify-content: center;
			color: white;
			flex-shrink: 0;
		}
	}
</style>
