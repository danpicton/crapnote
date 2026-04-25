<script lang="ts">
	import { goto } from '$app/navigation';
	import { ApiError } from '$lib/api';
	import { auth } from '$lib/stores/auth.svelte';
	import PasswordInput from '$lib/components/PasswordInput.svelte';

	let username = $state('');
	let password = $state('');
	let error = $state('');
	let submitting = $state(false);

	async function handleSubmit(e: Event) {
		e.preventDefault();
		error = '';
		submitting = true;
		try {
			await auth.login(username, password);
			goto('/');
		} catch (err) {
			if (err instanceof ApiError) {
				if (err.status === 403) {
					error = 'This account has been locked. Contact an administrator.';
				} else {
					error = 'Invalid username or password.';
				}
			} else {
				error = 'An unexpected error occurred.';
			}
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>Log in — Crapnote</title>
</svelte:head>

<div class="login-page">
	<div class="login-corner-mark">
		<span class="wm">Crapnote<span class="wm-dot" aria-hidden="true"></span></span>
	</div>

	<div class="login-box">
		<div class="login-hero">
			<div class="hero-wordmark">
				Crapnote<span class="hero-dot" aria-hidden="true"></span>
			</div>
			<p class="hero-tagline">Whatever you'd scribble on a napkin — better kept.</p>
		</div>

		<form onsubmit={handleSubmit} class="login-form">
			{#if error}
				<p role="alert" class="error">{error}</p>
			{/if}

			<div class="field">
				<label for="username">Username</label>
				<input
					id="username"
					type="text"
					autocomplete="username"
					bind:value={username}
					disabled={submitting}
					required
				/>
			</div>

			<div class="field">
				<label for="password">Password</label>
				<PasswordInput
					id="password"
					autocomplete="current-password"
					bind:value={password}
					disabled={submitting}
					required
				/>
			</div>

			<button type="submit" class="login-btn" disabled={submitting}>
				{submitting ? 'Logging in…' : 'Log in'}<span class="btn-dot" aria-hidden="true">.</span>
			</button>
		</form>
	</div>

	<div class="login-footer">
		<span>Notes, kept simple.</span>
	</div>
</div>

<style>
	.login-page {
		min-height: 100dvh;
		background: var(--bg);
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
		padding: 2rem 1rem;
		box-sizing: border-box;
	}

	.login-corner-mark {
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
		display: inline-flex;
		align-items: baseline;
	}
	.wm-dot {
		display: inline-block;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--accent);
		margin-left: 2px;
		margin-bottom: 1px;
	}

	.login-box {
		width: 100%;
		max-width: 400px;
	}

	.login-hero { margin-bottom: 2.5rem; }

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

	.hero-tagline {
		font-family: var(--serif);
		font-style: italic;
		font-size: 1.125rem;
		color: var(--text-3);
		margin: 0.75rem 0 0;
	}

	.login-form {
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

	input {
		width: 100%;
		box-sizing: border-box;
		font-family: var(--serif);
		font-size: 1.125rem;
		color: var(--text);
		background: transparent;
		border: none;
		outline: none;
		border-bottom: 1.5px solid var(--border);
		padding: 0.375rem 0 0.625rem;
		transition: border-color 0.15s;
	}
	input:focus { border-bottom-color: var(--accent); }
	input:disabled { opacity: 0.6; }

	/* Match PasswordInput to the underline-only style */
	:global(.login-form .pw-wrap) { display: block; position: relative; }
	:global(.login-form .pw-wrap input) {
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
	:global(.login-form .pw-wrap input:focus) {
		border-bottom-color: var(--accent);
		box-shadow: none;
	}
	:global(.login-form .pw-wrap .toggle) {
		position: absolute;
		right: 0;
		bottom: 0.25rem;
		top: auto;
		transform: none;
		background: transparent;
	}

	.login-btn {
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
	.login-btn:disabled { opacity: 0.6; cursor: not-allowed; }
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

	.login-footer {
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
