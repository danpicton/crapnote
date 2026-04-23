<script lang="ts">
	import { Eye, EyeOff } from 'lucide-svelte';

	interface Props {
		id: string;
		value: string;
		autocomplete?: string;
		placeholder?: string;
		required?: boolean;
		disabled?: boolean;
		onchange?: (value: string) => void;
	}

	let {
		id,
		value = $bindable(''),
		autocomplete,
		placeholder,
		required = false,
		disabled = false,
		onchange,
	}: Props = $props();

	let visible = $state(false);

	function handleInput(e: Event) {
		const target = e.currentTarget as HTMLInputElement;
		value = target.value;
		onchange?.(target.value);
	}
</script>

<div class="pw-wrap">
	<input
		{id}
		type={visible ? 'text' : 'password'}
		value={value}
		autocomplete={autocomplete ?? 'current-password'}
		{placeholder}
		{required}
		{disabled}
		oninput={handleInput}
	/>
	<button
		type="button"
		class="toggle"
		onclick={() => (visible = !visible)}
		aria-label={visible ? 'Hide password' : 'Show password'}
		title={visible ? 'Hide password' : 'Show password'}
		tabindex="-1"
	>
		{#if visible}
			<EyeOff size={16} />
		{:else}
			<Eye size={16} />
		{/if}
	</button>
</div>

<style>
	.pw-wrap {
		position: relative;
		display: flex;
		align-items: stretch;
	}

	.pw-wrap input {
		flex: 1;
		min-width: 0;
		padding: 0.5rem 2.25rem 0.5rem 0.75rem;
		border: 1px solid var(--border-md);
		border-radius: 0.375rem;
		font-size: 1rem;
		background: var(--bg);
		color: var(--text);
	}

	.pw-wrap input:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 2px var(--focus-ring);
	}

	.toggle {
		position: absolute;
		right: 0.25rem;
		top: 50%;
		transform: translateY(-50%);
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		padding: 0;
		border: none;
		border-radius: 0.25rem;
		background: transparent;
		color: var(--text-3);
		cursor: pointer;
	}

	.toggle:hover {
		background: var(--bg-hover);
		color: var(--text);
	}

	.toggle:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}
</style>
