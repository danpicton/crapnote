<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ArchiveRestore, Trash2, ChevronLeft, Archive as ArchiveIcon } from 'lucide-svelte';
	import { api, type Note } from '$lib/api';
	import MobileTabBar from '$lib/components/MobileTabBar.svelte';

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

	// Mobile swipe state (archive: left-swipe = Restore + Delete forever; right-swipe disabled)
	let swipeX = $state<Record<number, number>>({});
	let swipeActive = $state<number | null>(null);
	let swipeBaseX = 0;
	let swipeStartX = 0;
	let swipeStartY = 0;
	let swipeAxisLocked = false;

	function onSwipeStart(e: TouchEvent, id: number) {
		swipeStartX = e.touches[0].clientX;
		swipeStartY = e.touches[0].clientY;
		swipeBaseX = swipeX[id] ?? 0;
		swipeActive = id;
		swipeAxisLocked = false;
	}

	function onSwipeMove(e: TouchEvent, id: number) {
		if (swipeActive !== id) return;
		const rawDx = e.touches[0].clientX - swipeStartX;
		const rawDy = e.touches[0].clientY - swipeStartY;
		if (!swipeAxisLocked) {
			if (Math.abs(rawDx) < 5 && Math.abs(rawDy) < 5) return;
			if (Math.abs(rawDy) > Math.abs(rawDx)) { swipeActive = null; return; }
			swipeAxisLocked = true;
		}
		e.preventDefault();
		// Archive: only allow left-swipe (negative dx)
		const newX = Math.min(0, Math.max(-180, swipeBaseX + rawDx));
		swipeX = { ...swipeX, [id]: newX };
	}

	function onSwipeEnd(id: number) {
		if (swipeActive !== id) return;
		swipeActive = null;
		const x = swipeX[id] ?? 0;
		swipeX = { ...swipeX, [id]: x <= -60 ? -144 : 0 };
	}

	function resetSwipe(id: number) {
		swipeX = { ...swipeX, [id]: 0 };
	}

	function notePreview(body: string): string {
		if (!body?.trim()) return '';
		return body
			.replace(/<br\s*\/?>/gi, '\n')
			.replace(/!\[[^\]]*\]\([^)]*\)/g, '<image content>\n')
			.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
			.replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
			.replace(/\*\*([^*]+)\*\*/g, '$1')
			.replace(/__([^_]+)__/g, '$1')
			.replace(/\*([^*\n]+)\*/g, '$1')
			.replace(/_([^_\n]+)_/g, '$1')
			.replace(/^>\s?/gm, '')
			.replace(/^[-*_]{3,}\s*$/gm, '')
			.replace(/\n{2,}/g, '\n')
			.trim()
			.slice(0, 300);
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

		<!-- Mobile page title -->
		<div class="mob-page-title-row">
			<a href="/" class="mob-back-btn" aria-label="Back to notes"><ChevronLeft size={22} /></a>
			<h1 class="mob-page-title">Archive<span class="accent-dot">.</span></h1>
		</div>

		{#if loading}
			<p class="status">Loading…</p>
		{:else if notes.length === 0}
			<!-- Mobile empty state -->
			<div class="mob-empty-state">
				<div class="mob-empty-icon"><ArchiveIcon size={28} aria-hidden="true" /></div>
				<p class="mob-empty-title">Nothing archived</p>
				<p class="mob-empty-sub">Swipe a note left and tap Archive to tuck it away here.</p>
			</div>
			<p class="status desk-only">Archive is empty.</p>
		{:else}
			<ul class="note-list">
				{#each notes as note (note.id)}
					<li class="note-item" class:expanded={expandedId === note.id} style="--swipe-x: {swipeX[note.id] ?? 0}px">
						<!-- Mobile swipe actions (left-swipe only in archive) -->
						<div class="mob-swipe-right" class:mob-swipe-visible={(swipeX[note.id] ?? 0) < -4}>
							<button
								class="mob-swipe-btn mob-swipe-restore"
								onclick={(e) => { e.stopPropagation(); resetSwipe(note.id); void unarchive(note.id); }}
								aria-label="Restore note"
							>
								<ArchiveRestore size={20} aria-hidden="true" />
								<span>Restore</span>
							</button>
							<button
								class="mob-swipe-btn mob-swipe-delete"
								onclick={(e) => { e.stopPropagation(); resetSwipe(note.id); void deleteNote(note.id); }}
								aria-label="Delete permanently"
							>
								<Trash2 size={20} aria-hidden="true" />
								<span>Delete</span>
							</button>
						</div>

						<!-- Row body -->
						<div
							class="note-row-body"
							role="listitem"
							style="transition: {swipeActive === note.id ? 'none' : 'transform 250ms cubic-bezier(.2,.8,.2,1)'}"
							ontouchstart={(e) => onSwipeStart(e, note.id)}
							ontouchmove={(e) => onSwipeMove(e, note.id)}
							ontouchend={() => onSwipeEnd(note.id)}
						>
							<div class="note-row">
								<button class="note-title-btn" onclick={() => { if ((swipeX[note.id] ?? 0) !== 0) { resetSwipe(note.id); return; } if (window.matchMedia('(max-width: 640px)').matches) { goto(`/archive/${note.id}`); } else { toggleExpand(note.id); } }}>
									<span class="note-title">{note.title || 'Untitled'}</span>
									{#if note.body}
										<span class="note-preview">{notePreview(note.body)}</span>
									{/if}
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
									<div class="mob-note-actions">
										<button class="mob-note-action-btn" onclick={() => { expandedId = null; void unarchive(note.id); }}>
											<ArchiveRestore size={15} aria-hidden="true" /> Restore
										</button>
										<button class="mob-note-action-btn mob-note-action-danger" onclick={() => deleteNote(note.id)}>
											<Trash2 size={15} aria-hidden="true" /> Delete permanently
										</button>
									</div>
								</div>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
	<MobileTabBar activeTab="archive" />
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
		flex: 1;
		min-height: 0;
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

	/* Hide preview on desktop */
	.note-preview { display: none; }

	/* ── Mobile-only elements (hidden on desktop) ── */
	.mob-page-title-row,
	.mob-empty-state,
	.mob-swipe-right { display: none; }

	@media (max-width: 640px) {
		.archive-page {
			display: flex;
			flex-direction: column;
			overflow: hidden;
		}
		.archive-inner { padding: 0 20px 80px; overflow-y: auto; }

		/* Hide desktop-only elements */
		.wordmark, .page-header, .desk-only { display: none !important; }

		/* Mobile page title */
		.mob-page-title-row {
			display: flex;
			align-items: center;
			gap: 0.25rem;
			padding: calc(env(safe-area-inset-top, 0px) + 12px) 0 0.25rem;
			flex-shrink: 0;
		}
		.mob-back-btn {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 44px;
			height: 44px;
			color: var(--text-3);
			text-decoration: none;
			flex-shrink: 0;
			margin-left: -10px;
		}
		.mob-back-btn:hover { color: var(--text); }
		.mob-page-title {
			font-family: var(--serif);
			font-weight: 800;
			font-size: 1.875rem;
			letter-spacing: -0.04em;
			line-height: 1;
			color: var(--text);
			margin: 0;
		}

		/* Mobile empty state */
		.mob-empty-state {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			padding: 4rem 2rem;
			text-align: center;
			gap: 0.5rem;
		}
		.mob-empty-icon {
			width: 64px;
			height: 64px;
			border-radius: 50%;
			background: var(--bg-alt);
			display: flex;
			align-items: center;
			justify-content: center;
			color: var(--text-3);
			margin-bottom: 0.75rem;
		}
		.mob-empty-title {
			font-family: var(--serif);
			font-size: 1.125rem;
			font-weight: 700;
			color: var(--text);
			margin: 0;
		}
		.mob-empty-sub {
			font-size: 0.875rem;
			color: var(--text-3);
			margin: 0;
			max-width: 240px;
		}

		/* Swipeable note rows */
		.note-item {
			position: relative;
			overflow: hidden;
		}

		.mob-swipe-right {
			position: absolute;
			top: 0; right: 0; bottom: 0;
			display: flex;
			align-items: stretch;
			opacity: 0;
			pointer-events: none;
			transition: opacity 150ms;
		}
		.mob-swipe-right.mob-swipe-visible {
			opacity: 1;
			pointer-events: auto;
		}

		.mob-swipe-btn {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 4px;
			width: 72px;
			border: none;
			cursor: pointer;
			font-family: var(--sans);
			font-size: 11px;
			font-weight: 600;
			color: white;
			padding: 0;
		}
		.mob-swipe-restore { background: #5E8E6E; }
		.mob-swipe-delete  { background: #C0432A; }

		.note-row-body {
			transform: translateX(var(--swipe-x));
			background: var(--bg);
		}

		/* Hide desktop action buttons on mobile */
		.note-actions { display: none; }

		/* Larger tap targets for note title rows */
		.note-row {
			padding: 0.875rem 0;
			min-height: 56px;
		}
		.note-title-btn {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.15rem;
			width: 100%;
			text-align: left;
		}
		.note-title {
			font-size: 1rem;
		}
		.note-preview {
			display: block;
			position: relative;
			max-height: 2.8em;
			overflow: hidden;
			font-size: 0.8125rem;
			color: var(--text-3);
			font-family: var(--sans);
			line-height: 1.4;
			width: 100%;
			white-space: pre-line;
			overflow-wrap: anywhere;
		}
		.note-preview::after {
			content: '';
			position: absolute;
			top: 1.4em;
			bottom: 0;
			left: 0;
			right: 0;
			background: linear-gradient(to bottom, transparent, var(--bg));
			pointer-events: none;
		}
		.note-meta {
			font-size: 0.6875rem;
		}

		/* Suppress hover accent colour on touch devices */
		.note-title-btn:hover .note-title { color: var(--text); }

		/* Action buttons inside expanded note body */
		.mob-note-actions {
			display: flex;
			gap: 8px;
			padding: 10px 0 4px;
			border-top: 1px solid var(--border);
			margin-top: 10px;
		}
		.mob-note-action-btn {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			padding: 8px 14px;
			border: 1px solid var(--border);
			border-radius: 8px;
			background: var(--bg);
			color: var(--text-2);
			font-size: 13px;
			font-family: var(--sans);
			cursor: pointer;
		}
		.mob-note-action-btn:hover { background: var(--bg-hover); }
		.mob-note-action-danger { color: var(--danger); border-color: var(--danger-bd); background: var(--danger-bg); }
		.mob-note-action-danger:hover { background: var(--danger); color: white; }
	}

	@media (min-width: 641px) {
		.mob-note-actions { display: none; }
		.mob-page-title-row,
		.mob-empty-state,
		.mob-swipe-right { display: none !important; }
	}
</style>
