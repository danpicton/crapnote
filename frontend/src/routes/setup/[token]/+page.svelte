<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { api, ApiError } from '$lib/api';
	import PasswordInput from '$lib/components/PasswordInput.svelte';

	let username = $state('');
	let expiresAt = $state('');
	let loading = $state(true);
	let error = $state('');

	let newPassword = $state('');
	let newPasswordConfirm = $state('');
	let submitting = $state(false);

	const token = $derived(page.params.token ?? '');

	onMount(async () => {
		try {
			const result = await api.setup.get(token);
			username = result.username;
			expiresAt = result.expires_at;
		} catch (err) {
			error =
				err instanceof ApiError && err.status === 404
					? 'This setup link is invalid or has expired. Ask your administrator for a new one.'
					: 'Could not load the setup link. Please try again in a moment.';
		} finally {
			loading = false;
		}
	});

	async function handleSubmit(e: Event) {
		e.preventDefault();
		error = '';
		if (newPassword.length < 12) {
			error = 'Password must be at least 12 characters.';
			return;
		}
		if (newPassword !== newPasswordConfirm) {
			error = 'Passwords do not match.';
			return;
		}
		submitting = true;
		try {
			await api.setup.complete(token, newPassword);
			goto('/login');
		} catch (err) {
			if (err instanceof ApiError && err.status === 404) {
				error = 'This setup link is invalid or has expired.';
			} else if (err instanceof ApiError && err.status === 400) {
				error = 'Password not accepted. Use at least 12 characters.';
			} else {
				error = 'Could not set your password. Please try again.';
			}
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>Set your password — Crapnote</title>
</svelte:head>

<div class="setup-container">
	<h1>Welcome to Crapnote</h1>

	{#if loading}
		<p>Loading…</p>
	{:else if username}
		<p class="intro">
			You're setting the password for <strong>{username}</strong>. Choose something at least
			12 characters long. You'll use this password to log in from now on.
		</p>
		{#if expiresAt}
			<p class="hint">This link expires on {new Date(expiresAt).toLocaleString()}.</p>
		{/if}

		<form onsubmit={handleSubmit}>
			{#if error}
				<p role="alert" class="error">{error}</p>
			{/if}

			<div class="field">
				<label for="new-password">New password</label>
				<PasswordInput
					id="new-password"
					autocomplete="new-password"
					bind:value={newPassword}
					disabled={submitting}
					required
				/>
			</div>
			<div class="field">
				<label for="new-password-confirm">Confirm new password</label>
				<PasswordInput
					id="new-password-confirm"
					autocomplete="new-password"
					bind:value={newPasswordConfirm}
					disabled={submitting}
					required
				/>
			</div>
			<button type="submit" disabled={submitting}>
				{submitting ? 'Setting password…' : 'Set password'}
			</button>
		</form>
	{:else}
		<p role="alert" class="error">{error || 'Setup link invalid.'}</p>
	{/if}
</div>

<style>
	.setup-container {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-width: 380px;
		margin: 0 auto;
		padding: 4rem 1rem 2rem;
	}

	h1 {
		font-size: 1.5rem;
		margin: 0;
	}

	.intro { color: var(--text-2); font-size: 0.9rem; margin: 0; }
	.hint { color: var(--text-3); font-size: 0.8125rem; margin: 0; }

	form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-top: 0.5rem;
	}

	.field { display: flex; flex-direction: column; gap: 0.25rem; }
	.field label { font-weight: 500; font-size: 0.875rem; color: var(--text-2); }

	button[type='submit'] {
		padding: 0.625rem;
		background: var(--accent);
		color: white;
		border: none;
		border-radius: 0.375rem;
		font-size: 1rem;
		font-weight: 500;
		cursor: pointer;
	}
	button[type='submit']:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.error {
		color: var(--danger);
		font-size: 0.875rem;
		padding: 0.5rem 0.75rem;
		background: var(--danger-bg);
		border: 1px solid var(--danger-bd);
		border-radius: 0.375rem;
		margin: 0;
	}
</style>
