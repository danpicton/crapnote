<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ApiError, OfflineError } from '$lib/api';
	import { auth } from '$lib/stores/auth.svelte';
	import { readSessionUser } from '$lib/localData';
	import { hasUnlockPasscode } from '$lib/offlineUnlock';
	import { hasStashedShare } from '$lib/share';
	import PasswordInput from '$lib/components/PasswordInput.svelte';

	let username = $state('');
	let password = $state('');
	let error = $state('');
	let submitting = $state(false);
	let notice = $state('');

	/**
	 * Explain the dead end before it is walked into.
	 *
	 * Someone can land here with a pocketful of cached notes they cannot
	 * reach: offline with nothing to log in against, or — the pre-upgrade
	 * window — a browser that remembers who was last signed in but holds no
	 * unlock material, because the session was restored from a cookie and the
	 * app never saw a password to record. Both look like a blank login form
	 * with no explanation, and the second is not obviously recoverable unless
	 * we say how.
	 */
	onMount(() => {
		const remembered = readSessionUser();
		const canUnlockOffline = remembered !== null && hasUnlockPasscode(remembered.id);
		if (remembered && !canUnlockOffline) {
			notice =
				'This device has notes saved offline but cannot open them yet. Log in once here to unlock them the next time you are offline.';
		} else if (typeof navigator !== 'undefined' && !navigator.onLine) {
			notice = "You're offline. Reconnect to log in.";
		}
	});

	/**
	 * Word the 403 for the kind of lock that produced it.
	 *
	 * The server only answers 403 once the password has checked out, so both
	 * variants are safe to name here — an attacker guessing at usernames never
	 * sees either (issue #62). What differs is the advice: an admin lock is
	 * indefinite and really does need a human, while a failed-attempt cool-down
	 * clears itself in minutes, and sending that user off to find an
	 * administrator wastes everyone's time.
	 *
	 * The cool-down wording deliberately blames neither field. It is keyed on
	 * the submitted username, so five goes at a username that does not exist
	 * lands here too — the reader may have fumbled either half, or be an
	 * attacker who is owed no detail at all.
	 *
	 * The reason travels as a machine-readable `code` in the JSON body, which
	 * ApiError carries verbatim as its message. Anything unparseable or
	 * unrecognised falls back to the locked wording — the conservative half,
	 * since it never tells someone to sit and wait for a lock that will not
	 * lift.
	 */
	function lockedMessage(err: ApiError): string {
		let code = '';
		try {
			code = (JSON.parse(err.message) as { code?: string }).code ?? '';
		} catch {
			// Non-JSON body (a proxy's own 403 page, say) — fall through.
		}
		return code === 'login_cooldown'
			? 'Too many failed login attempts. Check your username and password, then try again in a few minutes.'
			: 'This account has been locked. Contact an administrator.';
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		error = '';
		submitting = true;
		try {
			await auth.login(username, password);
			// A share that arrived while signed out is waiting to be filed —
			// finish it rather than dropping the user on the notes list.
			goto(hasStashedShare() ? '/share?restore=1' : '/');
		} catch (err) {
			if (err instanceof OfflineError) {
				// OfflineError extends ApiError, so this check must come first
				// or an offline attempt reads as "invalid credentials".
				//
				// The standing notice above already explains what logging in
				// once online buys, so keep this to the immediate fact.
				error = "You're offline. Reconnect to log in.";
			} else if (err instanceof ApiError) {
				if (err.status === 403) {
					error = lockedMessage(err);
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
			{:else if notice}
				<p class="notice">{notice}</p>
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
	.notice {
		font-family: var(--sans);
		font-size: 0.8125rem;
		line-height: 1.4;
		color: var(--text-3);
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
