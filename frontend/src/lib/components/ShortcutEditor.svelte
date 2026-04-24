<script lang="ts">
	import { shortcuts, formatCombo, type ShortcutId } from '$lib/stores/shortcuts.svelte';

	let recordingId = $state<ShortcutId | null>(null);
	// Force re-reading shortcuts.list on each render by tracking a tick.
	let tick = $state(0);

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const rows = $derived.by(() => {
		void tick;
		return shortcuts.list;
	});

	const MODIFIER_ONLY = new Set(['Control', 'Shift', 'Alt', 'Meta', 'Command', 'OS']);

	function onKeydown(e: KeyboardEvent) {
		if (recordingId == null) return;
		// Ignore pure modifier presses — wait for the actual key.
		if (MODIFIER_ONLY.has(e.key)) return;
		if (e.key === 'Escape') {
			// Cancel recording without saving.
			recordingId = null;
			e.preventDefault();
			return;
		}
		e.preventDefault();
		e.stopPropagation();

		const combo = formatCombo({
			key: e.key.length === 1 ? e.key.toLowerCase() : e.key,
			ctrl: e.ctrlKey || e.metaKey,
			shift: e.shiftKey,
			alt: e.altKey,
		});
		shortcuts.setBinding(recordingId, combo);
		recordingId = null;
		tick += 1;
	}

	function startRecording(id: ShortcutId) {
		recordingId = id;
	}

	function resetOne(id: ShortcutId) {
		shortcuts.resetBinding(id);
		tick += 1;
	}

	function resetAll() {
		shortcuts.resetAll();
		tick += 1;
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="shortcut-editor">
	<div class="row-header">
		<span class="col-desc">Action</span>
		<span class="col-combo">Shortcut</span>
		<span class="col-actions"></span>
	</div>
	<ul class="rows">
		{#each rows as row (row.id)}
			<li class="row" data-testid="shortcut-row-{row.id}">
				<span class="col-desc">{row.description}</span>
				<span class="col-combo">
					{#if recordingId === row.id}
						<em class="recording">Press a combo… (Esc to cancel)</em>
					{:else}
						<kbd>{shortcuts.displayCombo(row.combo)}</kbd>
					{/if}
				</span>
				<span class="col-actions">
					<button
						type="button"
						data-role="record"
						onclick={() => startRecording(row.id)}
						disabled={recordingId != null && recordingId !== row.id}
					>
						{recordingId === row.id ? 'Recording…' : 'Record'}
					</button>
					<button
						type="button"
						data-role="reset"
						class="reset"
						onclick={() => resetOne(row.id)}
						title="Reset to default"
						aria-label="Reset {row.description} to default"
					>
						↺
					</button>
				</span>
			</li>
		{/each}
	</ul>
	<button type="button" class="reset-all" onclick={resetAll}>Reset all to defaults</button>
</div>

<style>
	.shortcut-editor {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.row-header {
		display: grid;
		grid-template-columns: 1fr auto auto;
		gap: 0.75rem;
		padding: 0 0 0.25rem;
		font-size: 0.75rem;
		color: var(--text-3);
		border-bottom: 1px solid var(--border);
	}

	.rows {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.row {
		display: grid;
		grid-template-columns: 1fr auto auto;
		gap: 0.75rem;
		align-items: center;
		padding: 0.35rem 0;
		border-bottom: 1px solid var(--border);
		font-size: 0.875rem;
	}

	.row:last-child { border-bottom: none; }

	.col-desc { color: var(--text-2); }

	.col-combo kbd {
		display: inline-block;
		padding: 0.125rem 0.5rem;
		background: var(--bg-hover);
		border: 1px solid var(--border-md);
		border-radius: 0.25rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.85rem;
		color: var(--text);
	}

	.recording {
		font-style: italic;
		color: var(--accent);
	}

	.col-actions {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
	}

	button {
		padding: 0.2rem 0.55rem;
		border: 1px solid var(--border-md);
		border-radius: 0.25rem;
		background: transparent;
		color: var(--text-2);
		font-size: 0.75rem;
		cursor: pointer;
	}

	button:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--text);
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.reset {
		padding: 0.2rem 0.45rem;
		font-size: 0.875rem;
	}

	.reset-all {
		align-self: flex-start;
		margin-top: 0.5rem;
	}
</style>
