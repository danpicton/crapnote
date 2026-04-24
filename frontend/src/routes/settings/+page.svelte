<script lang="ts">
	import { ChevronLeft, Moon, Sun, Users } from 'lucide-svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { theme } from '$lib/stores/theme.svelte';
	import ApiTokens from '$lib/components/ApiTokens.svelte';
	import PasswordInput from '$lib/components/PasswordInput.svelte';
	import ShortcutEditor from '$lib/components/ShortcutEditor.svelte';
	import { api, ApiError } from '$lib/api';

	let exportPassword = $state('');

	let currentPassword = $state('');
	let newPassword = $state('');
	let newPasswordConfirm = $state('');
	let pwError = $state('');
	let pwSuccess = $state('');
	let pwSubmitting = $state(false);

	const canCreateTokens = $derived(
		!!auth.user && (auth.user.is_admin || !!auth.user.api_tokens_enabled),
	);

	function doExport() {
		const url = exportPassword
			? `/api/export?password=${encodeURIComponent(exportPassword)}`
			: '/api/export';
		const a = document.createElement('a');
		a.href = url;
		a.download = '';
		a.click();
	}

	async function changePassword(e: Event) {
		e.preventDefault();
		pwError = '';
		pwSuccess = '';
		if (newPassword.length < 12) {
			pwError = 'New password must be at least 12 characters.';
			return;
		}
		if (newPassword !== newPasswordConfirm) {
			pwError = 'New passwords do not match.';
			return;
		}
		pwSubmitting = true;
		try {
			await api.auth.changePassword(currentPassword, newPassword);
			pwSuccess = 'Password updated.';
			currentPassword = '';
			newPassword = '';
			newPasswordConfirm = '';
		} catch (err) {
			if (err instanceof ApiError && err.status === 403) {
				pwError = 'Current password is incorrect.';
			} else if (err instanceof ApiError && err.status === 400) {
				pwError = 'New password is not acceptable. Use at least 12 characters.';
			} else {
				pwError = 'Failed to update password.';
			}
		} finally {
			pwSubmitting = false;
		}
	}
</script>

<svelte:head>
	<title>Settings — Crapnote</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<a href="/" class="back-btn" title="Back to notes" aria-label="Back to notes">
			<ChevronLeft size={20} />
		</a>
		<h1>Settings</h1>
	</header>

	<section class="section">
		<h2>Export</h2>
		<p class="hint">Download all your notes as a ZIP of Markdown files. Optionally protect with a password.</p>
		<div class="export-row">
			<input
				type="password"
				placeholder="Password (optional)"
				bind:value={exportPassword}
				autocomplete="new-password"
			/>
			<button class="export-btn" onclick={doExport}>
				Export notes
			</button>
		</div>
	</section>

	{#if auth.user?.is_admin}
		<section class="section">
			<h2>Administration</h2>
			<a href="/admin" class="admin-btn" title="User management" aria-label="User management">
				<Users size={16} />
				User management
			</a>
		</section>
	{/if}

	<section class="section">
		<h2>Change password</h2>
		{#if pwError}
			<p role="alert" class="error">{pwError}</p>
		{/if}
		{#if pwSuccess}
			<p role="status" class="success">{pwSuccess}</p>
		{/if}
		<form class="pw-form" onsubmit={changePassword}>
			<div class="pw-row">
				<label for="current-password">Current password</label>
				<PasswordInput
					id="current-password"
					autocomplete="current-password"
					bind:value={currentPassword}
					disabled={pwSubmitting}
					required
				/>
			</div>
			<div class="pw-row">
				<label for="new-password">New password</label>
				<PasswordInput
					id="new-password"
					autocomplete="new-password"
					bind:value={newPassword}
					disabled={pwSubmitting}
					required
				/>
			</div>
			<div class="pw-row">
				<label for="new-password-confirm">Confirm new password</label>
				<PasswordInput
					id="new-password-confirm"
					autocomplete="new-password"
					bind:value={newPasswordConfirm}
					disabled={pwSubmitting}
					required
				/>
			</div>
			<button type="submit" class="pw-submit" disabled={pwSubmitting}>
				{pwSubmitting ? 'Updating…' : 'Update password'}
			</button>
		</form>
	</section>

	<section class="section">
		<h2>Keyboard shortcuts</h2>
		<p class="hint">
			Shortcuts are stored in this browser and apply only to your account.
			Press <kbd>?</kbd> anywhere to view the cheat sheet.
		</p>
		<ShortcutEditor />
	</section>

	<section class="section">
		<h2>Appearance</h2>
		<button
			class="theme-btn"
			onclick={() => theme.toggle()}
		>
			{#if theme.current === 'light'}
				<Moon size={15} /> Enable dark mode
			{:else}
				<Sun size={15} /> Enable light mode
			{/if}
		</button>
	</section>

	<section class="section">
		<h2>Developer</h2>
		<p class="hint">
			API tokens let external clients (CLIs, scripts) call the CrapNote API with a
			<code>Authorization: Bearer cnp_…</code> header. Each token is shown once on
			creation and can be revoked at any time.
		</p>
		<ApiTokens canCreate={canCreateTokens} />
	</section>

	<section class="section">
		<h2>Account</h2>
		<p class="hint">Logged in as <strong>{auth.user?.username}</strong></p>
	</section>
</div>

<style>
	.page { max-width: 560px; margin: 0 auto; padding: 2rem 1rem; }

	.page-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
	}

	.back-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.25rem;
		border-radius: 0.375rem;
		color: var(--text-3);
		text-decoration: none;
		flex-shrink: 0;
	}
	.back-btn:hover { background: var(--bg-hover); color: var(--text); }

	h1 { font-size: 1.5rem; margin: 0; }
	h2 { font-size: 1rem; margin: 0 0 0.5rem; color: var(--text-2); }

	.section {
		margin-bottom: 2rem;
		padding-bottom: 1.5rem;
		border-bottom: 1px solid var(--border);
	}
	.section:last-child { border-bottom: none; }

	.hint { font-size: 0.875rem; color: var(--text-3); margin: 0 0 0.75rem; }
	.hint kbd {
		padding: 0 0.35rem;
		border: 1px solid var(--border-md);
		border-radius: 0.25rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.8rem;
		background: var(--bg-hover);
		color: var(--text);
	}

	.export-row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
	}

	.export-row input {
		padding: 0.375rem 0.625rem;
		border: 1px solid var(--border-md);
		border-radius: 0.375rem;
		font-size: 0.875rem;
		flex: 1;
		min-width: 150px;
		background: var(--bg);
		color: var(--text);
	}

	.export-btn {
		padding: 0.375rem 0.875rem;
		background: var(--accent);
		color: white;
		border: none;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
		white-space: nowrap;
	}
	.export-btn:hover { background: var(--accent-dk); }

	.admin-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.625rem;
		border-radius: 0.375rem;
		color: var(--text-3);
		font-size: 0.875rem;
		text-decoration: none;
	}
	.admin-btn:hover { background: var(--bg-hover); color: var(--text); }

	.pw-form { display: flex; flex-direction: column; gap: 0.5rem; max-width: 24rem; }
	.pw-row { display: flex; flex-direction: column; gap: 0.25rem; }
	.pw-row label { font-size: 0.8125rem; color: var(--text-2); }
	.pw-submit {
		align-self: flex-start;
		margin-top: 0.25rem;
		padding: 0.375rem 0.875rem;
		background: var(--accent);
		color: white;
		border: none;
		border-radius: 0.375rem;
		font-size: 0.875rem;
		cursor: pointer;
	}
	.pw-submit:hover { background: var(--accent-dk); }
	.pw-submit:disabled { opacity: 0.6; cursor: not-allowed; }

	.error {
		color: var(--danger);
		font-size: 0.875rem;
		padding: 0.375rem 0.625rem;
		background: var(--danger-bg);
		border-radius: 0.375rem;
		margin: 0 0 0.5rem;
	}
	.success {
		color: var(--accent);
		font-size: 0.875rem;
		padding: 0.375rem 0.625rem;
		background: var(--accent-lt);
		border-radius: 0.375rem;
		margin: 0 0 0.5rem;
	}

	.theme-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.75rem;
		border: 1px solid var(--border-md);
		border-radius: 0.375rem;
		background: transparent;
		color: var(--text-2);
		font-size: 0.875rem;
		cursor: pointer;
	}
	.theme-btn:hover { background: var(--bg-hover); }
</style>
