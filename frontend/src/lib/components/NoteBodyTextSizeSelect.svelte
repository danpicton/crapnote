<script lang="ts">
	import {
		noteBodyTextSize,
		type NoteBodyTextSizeId,
	} from '$lib/stores/noteBodyTextSize.svelte';
</script>

<label class="text-size-control">
	<span>Text size</span>
	<select
		aria-label="Text size"
		value={noteBodyTextSize.current}
		onchange={(event) => noteBodyTextSize.set((event.currentTarget as HTMLSelectElement).value as NoteBodyTextSizeId)}
	>
		{#each noteBodyTextSize.sizes as size}
			<option value={size.id}>{size.label}</option>
		{/each}
	</select>
</label>

<style>
	.text-size-control {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		margin: 0 0.25rem;
		font-family: var(--sans);
		font-size: 0.75rem;
		color: var(--text-3);
		white-space: nowrap;
	}

	select {
		min-height: 2rem;
		border: 1px solid var(--border-md);
		border-radius: 0.25rem;
		padding: 0.15rem 1.5rem 0.15rem 0.35rem;
		background: var(--bg);
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}

	select:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
</style>
