<script lang="ts">
	import { goto } from '$app/navigation';
	import { ApiError } from '$lib/api';
	import { auth } from '$lib/stores/auth.svelte';

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
				error = 'Invalid username or password.';
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

<div class="login-container">
	<h1>Crapnote</h1>
	<form onsubmit={handleSubmit}>
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
			<input
				id="password"
				type="password"
				autocomplete="current-password"
				bind:value={password}
				disabled={submitting}
				required
			/>
		</div>

		<button type="submit" disabled={submitting}>
			{submitting ? 'Logging in…' : 'Log in'}
		</button>
	</form>
</div>

<style>
	.login-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: 1rem;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: 100%;
		max-width: 360px;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	label {
		font-weight: 500;
		font-size: 0.875rem;
	}

	input {
		padding: 0.5rem 0.75rem;
		border: 1px solid #d1d5db;
		border-radius: 0.375rem;
		font-size: 1rem;
	}

	input:focus {
		outline: none;
		border-color: #6366f1;
		box-shadow: 0 0 0 2px #6366f140;
	}

	button {
		padding: 0.625rem;
		background: #6366f1;
		color: white;
		border: none;
		border-radius: 0.375rem;
		font-size: 1rem;
		font-weight: 500;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.error {
		color: #dc2626;
		font-size: 0.875rem;
		padding: 0.5rem 0.75rem;
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 0.375rem;
	}
</style>
