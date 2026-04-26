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

<div class="setup-page">
	<div class="corner-mark">
		<a href="/" class="wm">Crapnote<span class="wm-dot" aria-hidden="true"></span></a>
	</div>

	<div class="setup-box">
		{#if loading}
			<p class="loading">Loading…</p>
		{:else if username}
			<div class="hero">
				<div class="hero-wordmark">
					Crapnote<span class="hero-dot" aria-hidden="true"></span>
				</div>
				<p class="hero-sub">
					You're setting up <strong class="hero-name">{username}</strong>. Choose a password at least 12 characters long.
				</p>
				{#if expiresAt}
					<p class="hero-expiry">
						Link expires {new Date(expiresAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.
					</p>
				{/if}
			</div>

			<form onsubmit={handleSubmit} class="setup-form">
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
				<button type="submit" class="submit-btn" disabled={submitting}>
					{submitting ? 'Setting password…' : 'Set password'}<span class="btn-dot" aria-hidden="true">.</span>
				</button>
			</form>
		{:else}
			<p role="alert" class="error">{error || 'Setup link invalid.'}</p>
		{/if}
	</div>

	<div class="setup-footer">
		<span>Notes, kept simple.</span>
	</div>
</div>

<style>
	.setup-page {
		min-height: 100dvh;
		background: var(--bg);
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
		padding: 2rem 1rem;
		box-sizing: border-box;
		font-family: var(--sans);
	}

	/* Corner wordmark */
	.corner-mark {
		position: absolute;
		top: 1.5rem;
		left: 2rem;
	}
	.wm {
		font-family: var(--serif);
		font-weight: 800;
		font-size: 1rem;
		letter-spacing: -0.02em;
		color: var(--text-3);
		text-decoration: none;
		display: inline-flex;
		align-items: baseline;
	}
	.wm:hover { color: var(--text); }
	.wm-dot {
		display: inline-block;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--accent);
		margin-left: 2px;
		margin-bottom: 1px;
	}

	.setup-box {
		width: 100%;
		max-width: 400px;
	}

	.loading {
		font-family: var(--sans);
		color: var(--text-4);
		font-size: 0.875rem;
	}

	/* Hero */
	.hero { margin-bottom: 2.5rem; }

	.hero-wordmark {
		font-family: var(--serif);
		font-weight: 800;
		font-size: 4.5rem;
		letter-spacing: -0.04em;
		line-height: 0.95;
		color: var(--text);
		display: inline-flex;
		align-items: baseline;
	}
	.hero-dot {
		display: inline-block;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--accent);
		margin-left: 5px;
		margin-bottom: 4px;
	}

	.hero-sub {
		font-family: var(--serif);
		font-style: italic;
		font-size: 1.125rem;
		color: var(--text-3);
		margin: 0.75rem 0 0;
		line-height: 1.5;
	}
	.hero-name {
		font-style: normal;
		font-weight: 700;
		color: var(--text);
	}

	.hero-expiry {
		font-family: var(--sans);
		font-size: 0.75rem;
		color: var(--text-4);
		margin: 0.5rem 0 0;
	}

	/* Form */
	.setup-form {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	label {
		font-family: var(--sans);
		font-size: 0.6875rem;
		color: var(--text-3);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	/* Style the PasswordInput component to match login's underline style */
	:global(.setup-form .pw-wrap) { display: block; position: relative; }
	:global(.setup-form .pw-wrap input) {
		width: 100%;
		box-sizing: border-box;
		font-family: var(--serif);
		font-size: 1.125rem;
		color: var(--text);
		background: transparent;
		border: none;
		border-radius: 0;
		border-bottom: 1.5px solid var(--border);
		outline: none;
		padding: 0.375rem 1.75rem 0.625rem 0;
		box-shadow: none;
		transition: border-color 0.15s;
	}
	:global(.setup-form .pw-wrap input:focus) {
		border-bottom-color: var(--accent);
		box-shadow: none;
	}
	:global(.setup-form .pw-wrap .toggle) {
		position: absolute;
		right: 0;
		bottom: 0.25rem;
		top: auto;
		transform: none;
		background: transparent;
	}

	.submit-btn {
		width: 100%;
		margin-top: 0.5rem;
		padding: 0.875rem 1rem;
		background: var(--text);
		color: var(--bg);
		border: none;
		cursor: pointer;
		font-family: var(--serif);
		font-weight: 600;
		font-size: 1.125rem;
		letter-spacing: -0.01em;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
	}
	.submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }
	.btn-dot { color: var(--accent); font-size: 1.5rem; line-height: 0.8; }

	.error {
		color: var(--danger);
		font-size: 0.8125rem;
		font-family: var(--sans);
		padding: 0.5rem 0.75rem;
		background: var(--danger-bg);
		border: 1px solid var(--danger-bd);
		margin: 0;
	}

	/* Footer */
	.setup-footer {
		position: absolute;
		bottom: 1.5rem;
		left: 2rem;
		right: 2rem;
		display: flex;
		justify-content: space-between;
		font-family: var(--sans);
		font-size: 0.6875rem;
		color: var(--text-4);
	}
</style>
