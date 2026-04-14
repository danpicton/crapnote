<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
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
	import { toggleLinkCommand } from '@milkdown/kit/preset/commonmark';
	import type { CmdKey } from '@milkdown/kit/core';
	import { api, type Note, type Tag } from '$lib/api';
	import Editor, { type EditorRef } from '$lib/components/Editor.svelte';
	import { openOfflineDB, getNote as getOfflineNote, upsertNote } from '$lib/offlineDB';
	import {
		Bold, Italic, Underline, Quote, Code, FileCode2,
		List, ListOrdered, Minus, Undo2, Redo2, Link,
		Plus, ChevronLeft, Tag as TagIcon,
	} from 'lucide-svelte';

	const noteId = $derived(Number($page.params.id));

	let note = $state<Note | null>(null);
	let noteTags = $state<Tag[]>([]);
	let allTags = $state<Tag[]>([]);
	let saving = $state(false);
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let editorRef = $state<EditorRef | null>(null);
	let showTagPopover = $state(false);
	let newTagName = $state('');
	let visibleTags = $derived(allTags.filter(t => t.note_count > 0));

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
<div class="note-page">
	<div class="toolbar" role="toolbar" aria-label="Formatting">
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

	<div class="editor-header">
		{#if noteTags.length > 0}
			<div class="note-tags-chips">
				{#each noteTags as tag (tag.id)}
					{@const c = tagColor(tag)}
					<span class="note-tag-chip" style="--tag-bg:{c.bg};--tag-text:{c.text}">
						<TagIcon size={9} />{tag.name}
					</span>
				{/each}
			</div>
		{/if}
		<input
			class="title-input"
			type="text"
			value={note.title}
			oninput={(e) => scheduleAutoSave('title', (e.target as HTMLInputElement).value)}
			placeholder="Note title"
		/>
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

	{#key noteId}
		<Editor
			value={note.body}
			onchange={(md) => scheduleAutoSave('body', md)}
			bind:ref={editorRef}
			oninsertlink={openLinkDialog}
		/>
	{/key}
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
</style>
