<script lang="ts">
	import { onMount } from 'svelte';
	import { ChevronLeft, RotateCcw, Trash2 } from 'lucide-svelte';
	import MobileTabBar from '$lib/components/MobileTabBar.svelte';
	import { api, OfflineError, type TrashEntry } from '$lib/api';

	// Mirrors trash.PurgeDays on the server; only used for the empty-state copy.
	const PURGE_DAYS = 7;

	let entries = $state<TrashEntry[]>([]);
	let loading = $state(true);
	let offline = $state(false);
	let failed = $state(false);

	onMount(async () => {
		try {
			entries = await api.trash.list();
		} catch (err) {
			// Trash isn't cached offline — say so instead of spinning on
			// "Loading…" forever. A genuine server failure gets its own
			// message, not a misleading "you're offline".
			if (err instanceof OfflineError) offline = true;
			else failed = true;
		} finally {
			loading = false;
		}
	});

	async function restore(noteId: number) {
		await api.trash.restore(noteId);
		entries = entries.filter((e) => e.note_id !== noteId);
	}

	async function deleteOne(noteId: number) {
		await api.trash.deleteOne(noteId);
		entries = entries.filter((e) => e.note_id !== noteId);
	}

	async function empty() {
		if (!confirm('Permanently delete all trashed notes?')) return;
		await api.trash.empty();
		entries = [];
	}

	function daysLeft(permanentDeleteAt: string): number {
		const diff = new Date(permanentDeleteAt).getTime() - Date.now();
		return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
	}
</script>

<svelte:head>
	<title>Trash — Crapnote</title>
</svelte:head>

<div class="trash-page">
	<!-- Desktop wordmark -->
	<a href="/" class="wordmark">Crapnote<span class="wordmark-dot" aria-hidden="true"></span></a>

	<!-- Mobile header (shaded, matches archive/note list style) -->
	<div class="mob-header">
		<div class="mob-header-row">
			<a href="/" class="mob-back-btn" aria-label="Back to notes"><ChevronLeft size={22} /></a>
			<span class="mob-wordmark">Trash<span class="mob-wordmark-dot" aria-hidden="true">.</span></span>
		</div>
		<button class="mob-empty-btn" onclick={empty} disabled={entries.length === 0}>
			Empty
		</button>
	</div>

	<div class="trash-inner">
		<!-- Desktop header -->
		<header class="page-header">
			<a href="/" class="back-btn" title="Back to notes" aria-label="Back to notes">
				<ChevronLeft size={20} />
			</a>
			<h1 class="page-title">Trash<span class="accent-dot" aria-hidden="true">.</span></h1>
			<button class="danger-btn desk-only" onclick={empty} disabled={entries.length === 0}>
				Empty trash
			</button>
		</header>

		{#if loading}
			<p class="status">Loading…</p>
		{:else if offline}
			<p class="status">Trash isn't available offline. Reconnect to view it.</p>
		{:else if failed}
			<p class="status">Couldn't load the trash. Please try again.</p>
		{:else if entries.length === 0}
			<div class="mob-empty-state">
				<div class="mob-empty-icon"><Trash2 size={28} aria-hidden="true" /></div>
				<p class="mob-empty-title">Nothing in the trash</p>
				<p class="mob-empty-sub">Deleted notes wait here for {PURGE_DAYS} days before they go for good.</p>
			</div>
			<p class="status desk-only">Trash is empty.</p>
		{:else}
			<ul class="entry-list">
				{#each entries as entry (entry.note_id)}
					<li class="entry">
						<div class="entry-info">
							<span class="entry-title">{entry.title}</span>
							<span class="entry-meta">
								Deleted {new Date(entry.deleted_at).toLocaleDateString()} ·
								<span class="countdown">{daysLeft(entry.permanent_delete_at)} days until permanent deletion</span>
							</span>
						</div>
						<div class="entry-actions">
							<button class="icon-btn restore" onclick={() => restore(entry.note_id)} title="Restore note" aria-label="Restore note">
								<RotateCcw size={15} />
							</button>
							<button class="icon-btn delete" onclick={() => deleteOne(entry.note_id)} title="Delete permanently" aria-label="Delete permanently">
								<Trash2 size={15} />
							</button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
	<MobileTabBar activeTab="trash" />
</div>

<style>
	/* ── Base ── */
	.trash-page {
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

	/* Mobile chrome is hidden on desktop */
	.mob-header { display: none; }
	.mob-empty-state { display: none; }

	/* ── Desktop inner ── */
	.trash-inner {
		max-width: 1040px;
		margin: 0 auto;
		padding: 0 3rem;
	}

	/* ── Desktop page header ── */
	.page-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		/* 3.5rem top clears the fixed .wordmark so the title can't overlap it. */
		padding: 3.5rem 0 1.5rem;
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
		flex: 1;
	}
	.accent-dot { color: var(--accent); }

	.danger-btn {
		padding: 0.375rem 0.75rem;
		background: var(--danger);
		color: white;
		border: none;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
	}
	.danger-btn:disabled { opacity: 0.4; cursor: not-allowed; }

	.status { color: var(--text-4); padding: 2rem 0; font-size: 0.875rem; }

	.entry-list {
		list-style: none;
		margin: 0;
		padding: 1.5rem 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.entry {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem 1rem;
		border: 1px solid var(--border);
		border-radius: 0.5rem;
	}

	.entry-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.entry-title { font-weight: 500; }

	.entry-meta { font-size: 0.75rem; color: var(--text-4); }

	.countdown { color: #f59e0b; }

	.entry-actions { display: flex; gap: 0.375rem; }

	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border: none;
		border-radius: 0.375rem;
		cursor: pointer;
		background: transparent;
	}

	.icon-btn.restore { color: var(--accent); }
	.icon-btn.restore:hover { background: var(--accent-lt); }

	.icon-btn.delete { color: var(--danger); }
	.icon-btn.delete:hover { background: var(--danger-bg); }

	/* ── Mobile (<= 640px) ── */
	@media (max-width: 640px) {
		.trash-page {
			display: flex;
			flex-direction: column;
			overflow: hidden;
		}

		.wordmark, .page-header, .desk-only { display: none !important; }

		/* Mobile shaded header — matches the archive header */
		.mob-header {
			display: flex;
			align-items: center;
			padding: calc(env(safe-area-inset-top, 0px) + 14px) 20px 12px;
			background: var(--bg-alt);
			flex-shrink: 0;
		}
		.mob-header-row {
			display: flex;
			align-items: center;
			height: 36px;
			flex: 1;
			min-width: 0;
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

		.mob-empty-btn {
			flex-shrink: 0;
			min-height: 36px;
			padding: 0 12px;
			background: none;
			border: none;
			color: var(--danger);
			font-family: var(--sans);
			font-size: 15px;
			cursor: pointer;
		}
		.mob-empty-btn:disabled { opacity: 0.35; }

		/* Scrollable inner */
		.trash-inner { padding: 0; flex: 1; overflow-y: auto; min-height: 0; }

		.entry-list { padding: 8px 0; gap: 0; }
		.entry {
			border: none;
			border-bottom: 1px solid var(--border);
			border-radius: 0;
			padding: 12px 20px;
		}
		.entry-title { font-size: 16px; }
		.entry-meta { font-size: 12px; }
		.icon-btn { width: 44px; height: 44px; }
		.status { padding: 2rem 20px; }

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
		.mob-empty-icon { color: var(--text-4); }
		.mob-empty-title {
			font-family: var(--serif);
			font-size: 20px;
			font-weight: 700;
			color: var(--text);
			margin: 0;
		}
		.mob-empty-sub {
			font-size: 14px;
			color: var(--text-4);
			margin: 0;
			max-width: 22ch;
		}
	}
</style>
