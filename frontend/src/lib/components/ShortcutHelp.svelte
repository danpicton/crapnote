<script lang="ts">
	import { shortcuts } from '$lib/stores/shortcuts.svelte';

	interface Props {
		open: boolean;
		onclose: () => void;
	}

	let { open = false, onclose }: Props = $props();

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onclose();
		}
	}
</script>

<svelte:window onkeydown={open ? handleKey : undefined} />

{#if open}
	<div
		class="sc-backdrop"
		role="presentation"
		onclick={onclose}
	></div>
	<div class="sc-modal" role="dialog" aria-modal="true" aria-labelledby="sc-title">
		<header class="sc-head">
			<h2 id="sc-title">Keyboard shortcuts</h2>
			<button class="sc-close" onclick={onclose} aria-label="Close">×</button>
		</header>
		<ul class="sc-list">
			{#each shortcuts.list as s (s.id)}
				<li>
					<span class="desc">{s.description}</span>
					<kbd>{shortcuts.displayCombo(s.combo)}</kbd>
				</li>
			{/each}
		</ul>
		<footer class="sc-foot">
			<p class="hint">Customise shortcuts in Settings → Keyboard shortcuts.</p>
		</footer>
	</div>
{/if}

<style>
	.sc-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		z-index: 900;
	}

	.sc-modal {
		position: fixed;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		width: min(520px, calc(100vw - 2rem));
		max-height: calc(100vh - 2rem);
		overflow: auto;
		background: var(--bg);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
		z-index: 901;
		padding: 1rem 1.25rem;
	}

	.sc-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.5rem;
	}

	h2 {
		font-size: 1.125rem;
		margin: 0;
	}

	.sc-close {
		background: transparent;
		border: none;
		font-size: 1.5rem;
		line-height: 1;
		color: var(--text-3);
		cursor: pointer;
	}
	.sc-close:hover { color: var(--text); }

	.sc-list {
		list-style: none;
		padding: 0;
		margin: 0 0 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.sc-list li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.25rem 0;
		border-bottom: 1px solid var(--border);
		font-size: 0.9rem;
	}
	.sc-list li:last-child { border-bottom: none; }

	.desc { color: var(--text-2); }

	kbd {
		display: inline-block;
		padding: 0.125rem 0.5rem;
		background: var(--bg-hover);
		border: 1px solid var(--border-md);
		border-radius: 0.25rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.85rem;
		color: var(--text);
	}

	.sc-foot .hint { font-size: 0.75rem; color: var(--text-3); margin: 0; }
</style>
