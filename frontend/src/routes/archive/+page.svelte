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

	function onNoteClick(id: number) {
		if ((swipeX[id] ?? 0) !== 0) { resetSwipe(id); return; }
		if (window.matchMedia('(max-width: 640px)').matches) {
			goto(`/archive/${id}`);
		} else {
			toggleExpand(id);
		}
	}

	// Swipe state (left-swipe only: reveals Restore + Delete)
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
	<!-- Desktop wordmark -->
	<a href="/" class="wordmark">Crapnote<span class="wordmark-dot" aria-hidden="true"></span></a>

	<!-- Mobile header (shaded, matches note list style) -->
	<div class="mob-header">
		<div class="mob-header-row">
			<a href="/" class="mob-back-btn" aria-label="Back to notes"><ChevronLeft size={22} /></a>
			<span class="mob-wordmark">Archive<span class="mob-wordmark-dot" aria-hidden="true">.</span></span>
		</div>
	</div>

	<div class="archive-inner">
		<!-- Desktop header -->
		<header class="page-header">
			<a href="/" class="back-btn" title="Back to notes" aria-label="Back to notes">
				<ChevronLeft size={20} />
			</a>
			<h1 class="page-title">Archive<span class="accent-dot" aria-hidden="true">.</span></h1>
		</header>

		{#if loading}
			<p class="status">Loading…</p>
		{:else if notes.length === 0}
			<div class="mob-empty-state">
				<div class="mob-empty-icon"><ArchiveIcon size={28} aria-hidden="true" /></div>
				<p class="mob-empty-title">Nothing archived</p>
				<p class="mob-empty-sub">Swipe a note left and tap Archive to tuck it away here.</p>
			</div>
			<p class="status desk-only">Archive is empty.</p>
		{:else}
			<ul class="note-list" role="list">
				{#each notes as note (note.id)}
					<li class="note-item" style="--swipe-x: {swipeX[note.id] ?? 0}px">
						<!-- Swipe panel (left-swipe = restore + delete) -->
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

						<div
							class="note-row-body"
							role="listitem"
							style="transition: {swipeActive === note.id ? 'none' : 'transform 250ms cubic-bezier(.2,.8,.2,1)'}"
							ontouchstart={(e) => onSwipeStart(e, note.id)}
							ontouchmove={(e) => onSwipeMove(e, note.id)}
							ontouchend={() => onSwipeEnd(note.id)}
						>
							<div
								class="note-btn"
								role="button"
								tabindex="0"
								onclick={() => onNoteClick(note.id)}
								onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && onNoteClick(note.id)}
							>
								<div class="note-row-top">
									<span class="note-title">{note.title || 'Untitled'}</span>
								</div>
								{#if notePreview(note.body)}
									<span class="note-preview">{notePreview(note.body)}</span>
								{/if}
								<span class="note-date">
									{new Date(note.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {new Date(note.updated_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
								</span>
							</div>
							<!-- Desktop action buttons -->
							<div class="note-hover-actions">
								<button class="act-btn" onclick={() => unarchive(note.id)} title="Restore from archive" aria-label="Restore from archive">
									<ArchiveRestore size={14} />
								</button>
								<button class="act-btn danger" onclick={() => deleteNote(note.id)} title="Delete permanently" aria-label="Delete permanently">
									<Trash2 size={14} />
								</button>
							</div>
						</div>

						<!-- Desktop expanded body -->
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
	<MobileTabBar activeTab="archive" />
</div>

<style>
	/* ── Base ── */
	.archive-page {
		height: 100dvh;
		overflow-y: auto;
		background: var(--bg);
		font-family: var(--sans);
	}

	/* ── Desktop wordmark ── */
	.wordmark {
		position: fixed;
		top: 1.25rem; left: 1.25rem;
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
		width: 7px; height: 7px;
		border-radius: 50%;
		background: var(--accent);
		margin-left: 3px; margin-bottom: 1px;
	}

	/* ── Desktop inner ── */
	.archive-inner {
		max-width: 1040px;
		margin: 0 auto;
		padding: 0 3rem;
	}

	/* ── Desktop page header ── */
	.page-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 2rem 0 1.5rem;
		border-bottom: 1px solid var(--border);
	}
	.back-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.25rem;
		color: var(--text-3);
		text-decoration: none;
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
	}
	.accent-dot { color: var(--accent); }

	.status { color: var(--text-4); padding: 2rem 0; font-size: 0.875rem; }

	/* ── Note list (shared desktop/mobile) ── */
	.note-list { list-style: none; margin: 0; padding: 0; }

	.note-item { border-bottom: 1px solid var(--border); }
	.note-item:first-child { border-top: 1px solid var(--border); }

	/* Desktop note button */
	.note-btn {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		padding: 0.75rem 0;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
		width: 100%;
		font-family: var(--sans);
	}
	.note-btn:hover .note-title { color: var(--accent); }

	.note-row-top { display: contents; }

	.note-title {
		font-family: var(--serif);
		font-weight: 600;
		font-size: 1rem;
		color: var(--text);
		flex-shrink: 0;
	}
	.note-date {
		font-size: 0.6875rem;
		color: var(--text-4);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	/* Desktop hover actions */
	.note-row-body { display: flex; align-items: center; gap: 0.5rem; }
	.note-hover-actions { display: flex; gap: 1px; flex-shrink: 0; margin-left: auto; }
	.act-btn {
		display: flex;
		align-items: center;
		padding: 0.3rem 0.35rem;
		background: none;
		border: 1px solid transparent;
		border-radius: 2px;
		cursor: pointer;
		color: var(--text-3);
		opacity: 0;
	}
	.note-row-body:hover .act-btn { opacity: 1; }
	.act-btn:hover { background: var(--bg-hover); color: var(--text-2); }
	.act-btn.danger:hover { background: var(--danger-bg); color: var(--danger); }

	/* Desktop expanded body */
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

	/* Hide preview and mobile elements on desktop */
	.note-preview { display: none; }
	.mob-header, .mob-empty-state, .mob-swipe-right { display: none; }

	/* ── Mobile ── */
	@media (max-width: 640px) {
		.archive-page {
			display: flex;
			flex-direction: column;
			overflow: hidden;
		}

		/* Hide desktop-only elements */
		.wordmark, .page-header, .desk-only { display: none !important; }

		/* Mobile shaded header — matches note list mob-header */
		.mob-header {
			display: flex;
			flex-direction: column;
			padding: calc(env(safe-area-inset-top, 0px) + 14px) 20px 12px;
			background: var(--bg-alt);
			flex-shrink: 0;
		}
		.mob-header-row {
			display: flex;
			align-items: center;
			height: 36px;
		}
		.mob-back-btn {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 36px;
			height: 36px;
			color: var(--text-3);
			text-decoration: none;
			flex-shrink: 0;
			margin-left: -8px;
			margin-right: 2px;
		}
		.mob-back-btn:hover { color: var(--text); }
		.mob-wordmark {
			font-family: var(--serif);
			font-size: 26px;
			font-weight: 700;
			line-height: 1;
			color: var(--text);
		}
		.mob-wordmark-dot { color: var(--accent); }

		/* Scrollable inner */
		.archive-inner { padding: 0; flex: 1; overflow-y: auto; min-height: 0; }

		/* Empty state */
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
			width: 64px; height: 64px;
			border-radius: 50%;
			background: var(--bg-alt);
			display: flex;
			align-items: center;
			justify-content: center;
			color: var(--text-3);
			margin-bottom: 0.75rem;
		}
		.mob-empty-title { font-family: var(--serif); font-size: 1.125rem; font-weight: 700; color: var(--text); margin: 0; }
		.mob-empty-sub { font-size: 0.875rem; color: var(--text-3); margin: 0; max-width: 240px; }

		/* Note items — swipeable */
		.note-item { position: relative; overflow: hidden; contain: paint; }

		.mob-swipe-right {
			display: flex;
			position: absolute;
			top: 0; right: 0; bottom: 0;
			align-items: stretch;
			pointer-events: none;
			opacity: 0;
			transition: opacity 150ms;
		}
		.mob-swipe-visible { pointer-events: auto; opacity: 1; }

		.mob-swipe-btn {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			width: 72px;
			gap: 4px;
			border: none;
			cursor: pointer;
			color: #FBF7F0;
			font-family: var(--sans);
			font-size: 11px;
			font-weight: 600;
			letter-spacing: 0.3px;
		}
		.mob-swipe-restore { background: var(--gesture-archive); }
		.mob-swipe-delete  { background: var(--gesture-delete); }

		/* Row body translates on swipe */
		.note-row-body {
			display: block;
			background: var(--bg);
			transform: translateX(var(--swipe-x, 0));
			will-change: transform;
			position: relative;
			z-index: 1;
		}

		/* Note button — exactly matches note list */
		.note-btn {
			display: flex;
			flex-direction: column;
			align-items: flex-start;
			padding: 16px 20px 12px;
			gap: 0;
		}
		.note-btn:hover .note-title { color: var(--text); }

		.note-row-top { display: flex; width: 100%; }

		.note-title {
			font-weight: 700;
			font-size: 18px;
			letter-spacing: -0.1px;
			line-height: 1.25;
			color: var(--text);
			flex: 1;
		}

		.note-preview {
			display: block;
			position: relative;
			max-height: 2.8em;
			overflow: hidden;
			font-family: var(--sans);
			font-size: 14px;
			color: var(--text-3);
			line-height: 1.4;
			margin: 4px 0 6px;
			white-space: pre-line;
			overflow-wrap: anywhere;
			width: 100%;
		}
		.note-preview::after {
			content: '';
			position: absolute;
			top: 1.4em; bottom: 0; left: 0; right: 0;
			background: linear-gradient(to bottom, transparent, var(--bg));
			pointer-events: none;
		}

		.note-date { font-size: 12px; letter-spacing: 0.1px; color: var(--text-4); }

		.note-hover-actions { display: none; }
		.note-body { display: none; }
	}

	@media (min-width: 641px) {
		.mob-header, .mob-empty-state, .mob-swipe-right { display: none !important; }
	}
</style>
