<script lang="ts">
	import { auth } from '$lib/stores/auth.svelte';
	import PasswordInput from '$lib/components/PasswordInput.svelte';

	let password = $state('');
	let error = $state('');
	let submitting = $state(false);
	let cooldownMs = $state(auth.unlockLockoutMs);

	// Tick the cooldown down so the form re-enables itself without a reload.
	$effect(() => {
		if (cooldownMs <= 0) return;
		const t = setInterval(() => {
			cooldownMs = Math.max(0, cooldownMs - 1000);
		}, 1000);
		return () => clearInterval(t);
	});

	function cooldownLabel(ms: number): string {
		const total = Math.ceil(ms / 1000);
		const m = Math.floor(total / 60);
		const s = total % 60;
		return m > 0 ? `${m}m ${s}s` : `${s}s`;
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (submitting || cooldownMs > 0) return;
		error = '';
		submitting = true;
		try {
			const ok = await auth.unlock(password);
			if (!ok) {
				cooldownMs = auth.unlockLockoutMs;
				error =
					cooldownMs > 0
						? `Too many attempts. Try again in ${cooldownLabel(cooldownMs)}.`
						: 'Incorrect password.';
			}
			password = '';
		} catch {
			// Never leave the form silent: an unlock that throws instead of
			// returning false would otherwise look like a dead button, and
			// the only other control here erases the device's copy.
			error = 'Unlock failed on this device. Reconnect and log in again to restore access.';
			password = '';
		} finally {
			submitting = false;
		}
	}

	async function handleLogout() {
		try {
			await auth.logout();
		} catch {
			// Offline, so the server call fails — the local wipe still ran.
		}
		location.assign('/login');
	}
</script>

<svelte:head>
	<title>Locked — Crapnote</title>
</svelte:head>

<div class="unlock-page">
	<div class="unlock-box">
		<div class="unlock-hero">
			<div class="hero-wordmark">Crapnote<span class="hero-dot" aria-hidden="true"></span></div>
			<p class="hero-tagline">
				Offline. Enter your password to open the notes saved on this device.
			</p>
		</div>

		<form onsubmit={handleSubmit} class="unlock-form">
			{#if error}
				<p role="alert" class="error">{error}</p>
			{/if}

			<div class="field">
				<!-- Deliberately not the username: before the password is
				     verified the person at the keyboard has not been shown to
				     be the account holder, and naming them would hand the next
				     person half a credential they did not have before. -->
				<label for="unlock-password">Password for this account</label>
				<PasswordInput
					id="unlock-password"
					autocomplete="current-password"
					bind:value={password}
					disabled={submitting || cooldownMs > 0}
					required
				/>
			</div>

			<button type="submit" class="unlock-btn" disabled={submitting || cooldownMs > 0}>
				{#if cooldownMs > 0}
					Locked for {cooldownLabel(cooldownMs)}
				{:else}
					{submitting ? 'Unlocking…' : 'Unlock'}<span class="btn-dot" aria-hidden="true">.</span>
				{/if}
			</button>
		</form>

		<button type="button" class="unlock-secondary" onclick={handleLogout}>
			Not you? Log out and erase this device's copy
		</button>
	</div>
</div>

<style>
	.unlock-page {
		min-height: 100dvh;
		background: var(--bg);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem 1rem;
		box-sizing: border-box;
	}
	.unlock-box {
		width: 100%;
		max-width: 22rem;
	}
	.unlock-hero {
		text-align: center;
		margin-bottom: 1.5rem;
	}
	.hero-wordmark {
		font-family: var(--serif);
		font-weight: 800;
		font-size: 1.75rem;
		letter-spacing: -0.03em;
		color: var(--text-1);
	}
	.hero-dot {
		display: inline-block;
		width: 0.3rem;
		height: 0.3rem;
		border-radius: 50%;
		background: var(--accent);
		margin-left: 0.15rem;
		vertical-align: baseline;
	}
	.hero-tagline {
		font-family: var(--sans);
		font-size: 0.8125rem;
		color: var(--text-3);
		margin: 0.5rem 0 0;
	}
	.unlock-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.field label {
		font-family: var(--sans);
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-3);
	}
	.error {
		font-family: var(--sans);
		font-size: 0.8125rem;
		color: var(--danger, #c0392b);
		margin: 0;
	}
	.unlock-btn {
		font-family: var(--sans);
		font-weight: 600;
		font-size: 0.875rem;
		padding: 0.6rem 1rem;
		border: none;
		border-radius: 0.375rem;
		background: var(--text-1);
		color: var(--bg);
		cursor: pointer;
	}
	.unlock-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.btn-dot {
		color: var(--accent);
	}
	.unlock-secondary {
		display: block;
		width: 100%;
		margin-top: 1.25rem;
		background: none;
		border: none;
		font-family: var(--sans);
		font-size: 0.75rem;
		color: var(--text-4);
		text-decoration: underline;
		cursor: pointer;
	}
</style>
