<script lang="ts">
	import PasswordInput from './PasswordInput.svelte';

	interface Props {
		open: boolean;
		title: string;
		submittingLabel?: string;
		submitLabel?: string;
		submitting?: boolean;
		externalError?: string;
		onsubmit: (password: string) => void;
		oncancel: () => void;
	}

	let {
		open,
		title,
		submitLabel = 'Save',
		submittingLabel = 'Saving…',
		submitting = false,
		externalError = '',
		onsubmit,
		oncancel,
	}: Props = $props();

	let pw = $state('');
	let confirm = $state('');
	let error = $state('');

	// Reset fields whenever the modal reopens.
	$effect(() => {
		if (open) {
			pw = '';
			confirm = '';
			error = '';
		}
	});

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			oncancel();
		}
	}

	function handleSubmit(e: Event) {
		e.preventDefault();
		error = '';
		if (pw.length < 12) {
			error = 'Password must be at least 12 characters.';
			return;
		}
		if (pw !== confirm) {
			error = 'Passwords do not match.';
			return;
		}
		onsubmit(pw);
	}
</script>

<svelte:window onkeydown={open ? handleKey : undefined} />

{#if open}
	<div class="pm-backdrop" role="presentation" onclick={oncancel}></div>
	<div class="pm-modal" role="dialog" aria-modal="true" aria-labelledby="pm-title">
		<header class="pm-head">
			<h2 id="pm-title">{title}</h2>
		</header>

		<form class="pm-form" onsubmit={handleSubmit}>
			{#if error || externalError}
				<p role="alert" class="error">{error || externalError}</p>
			{/if}

			<div class="pm-row">
				<label for="pm-new-password">New password</label>
				<PasswordInput
					id="pm-new-password"
					autocomplete="new-password"
					bind:value={pw}
					disabled={submitting}
					required
				/>
			</div>

			<div class="pm-row">
				<label for="pm-confirm-password">Confirm password</label>
				<PasswordInput
					id="pm-confirm-password"
					autocomplete="new-password"
					bind:value={confirm}
					disabled={submitting}
					required
				/>
			</div>

			<div class="pm-actions">
				<button type="button" class="cancel" onclick={oncancel} disabled={submitting}>
					Cancel
				</button>
				<button type="submit" class="submit" disabled={submitting}>
					{submitting ? submittingLabel : submitLabel}
				</button>
			</div>
		</form>
	</div>
{/if}

<style>
	.pm-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		z-index: 900;
	}

	.pm-modal {
		position: fixed;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		width: min(420px, calc(100vw - 2rem));
		background: var(--bg);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
		z-index: 901;
		padding: 1rem 1.25rem 1.25rem;
	}

	.pm-head h2 {
		font-size: 1rem;
		margin: 0 0 0.75rem;
	}

	.pm-form { display: flex; flex-direction: column; gap: 0.5rem; }
	.pm-row { display: flex; flex-direction: column; gap: 0.25rem; }
	.pm-row label { font-size: 0.8125rem; color: var(--text-2); }

	.pm-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	button {
		padding: 0.4rem 0.875rem;
		border-radius: 0.375rem;
		font-size: 0.875rem;
		cursor: pointer;
		border: 1px solid var(--border-md);
		background: transparent;
		color: var(--text);
	}
	button:hover:not(:disabled) { background: var(--bg-hover); }
	button:disabled { opacity: 0.6; cursor: not-allowed; }

	.submit {
		background: var(--accent);
		color: white;
		border-color: var(--accent);
	}
	.submit:hover:not(:disabled) { background: var(--accent-dk); }

	.error {
		color: var(--danger);
		font-size: 0.8125rem;
		padding: 0.375rem 0.625rem;
		background: var(--danger-bg);
		border-radius: 0.375rem;
		margin: 0;
	}
</style>
