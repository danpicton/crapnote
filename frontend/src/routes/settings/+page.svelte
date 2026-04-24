<script lang="ts">
	import { Sun, Moon, ChevronLeft } from 'lucide-svelte';
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
		!auth.loading && !!auth.user && (auth.user.is_admin || !!auth.user.api_tokens_enabled),
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

	let themeChoice = $derived(theme.current);

	function setTheme(t: 'light' | 'dark' | 'system') {
		if (t === 'system') {
			const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
			if (prefersDark && theme.current === 'light') theme.toggle();
			if (!prefersDark && theme.current === 'dark') theme.toggle();
		} else if (t !== theme.current) {
			theme.toggle();
		}
	}
</script>

<svelte:head>
	<title>Settings — Crapnote</title>
</svelte:head>

<div class="settings-page">
	<div class="settings-inner">
		<header class="page-header">
			<a href="/" class="back-btn" title="Back to notes" aria-label="Back to notes">
				<ChevronLeft size={20} />
			</a>
			<h1 class="page-title">Settings<span class="accent-dot" aria-hidden="true">.</span></h1>
			<span class="wm-small">Crapnote<span class="wm-dot" aria-hidden="true"></span></span>
		</header>

		<!-- Export -->
		<section class="section first-section">
			<div class="section-label">
				<h2>Export</h2>
				<p>Everything you've written, as Markdown.</p>
			</div>
			<div class="section-body">
				<div class="export-row">
					<input type="password" placeholder="Password (optional)" bind:value={exportPassword} autocomplete="new-password" class="field-input" />
					<button class="btn-primary" onclick={doExport}>Export notes</button>
				</div>
				<p class="hint">A ZIP of individual <code>.md</code> files. Password-protected if supplied.</p>
			</div>
		</section>

		<!-- Administration -->
		{#if !auth.loading && auth.user?.is_admin}
		<section class="section">
			<div class="section-label">
				<h2>Administration</h2>
				<p>Users and who can do what.</p>
			</div>
			<div class="section-body">
				<a href="/admin" class="btn-default btn-chevron">
					User management <span class="chevron">›</span>
				</a>
			</div>
		</section>
		{/if}

		<!-- Change password -->
		<section class="section">
			<div class="section-label">
				<h2>Change password</h2>
				<p>For this account. Signs you out of other sessions.</p>
			</div>
			<div class="section-body">
				{#if pwError}<p role="alert" class="msg-error">{pwError}</p>{/if}
				{#if pwSuccess}<p role="status" class="msg-success">{pwSuccess}</p>{/if}
				<form class="pw-form" onsubmit={changePassword}>
					<div class="pw-field">
						<label for="current-password" class="field-label">Current password</label>
						<PasswordInput id="current-password" autocomplete="current-password" bind:value={currentPassword} disabled={pwSubmitting} required />
					</div>
					<div class="pw-field">
						<label for="new-password" class="field-label">New password</label>
						<PasswordInput id="new-password" autocomplete="new-password" bind:value={newPassword} disabled={pwSubmitting} required />
					</div>
					<div class="pw-field">
						<label for="new-password-confirm" class="field-label">Confirm new password</label>
						<PasswordInput id="new-password-confirm" autocomplete="new-password" bind:value={newPasswordConfirm} disabled={pwSubmitting} required />
					</div>
					<button type="submit" class="btn-primary" disabled={pwSubmitting}>
						{pwSubmitting ? 'Updating…' : 'Update password'}
					</button>
				</form>
			</div>
		</section>

		<!-- Keyboard shortcuts -->
		<section class="section">
			<div class="section-label">
				<h2>Keyboard shortcuts</h2>
				<p>Stored on this device. Press <kbd>?</kbd> anywhere to view the cheat sheet.</p>
			</div>
			<div class="section-body">
				<ShortcutEditor />
			</div>
		</section>

		<!-- Appearance -->
		<section class="section">
			<div class="section-label">
				<h2>Appearance</h2>
				<p>How Crapnote looks on this device.</p>
			</div>
			<div class="section-body">
				<div class="segmented">
					<button class="seg-btn" class:seg-active={themeChoice === 'light'} onclick={() => setTheme('light')}>Light</button>
					<button class="seg-btn" class:seg-active={themeChoice === 'dark'} onclick={() => setTheme('dark')}>Dark</button>
					<button class="seg-btn" onclick={() => setTheme('system')}>System</button>
				</div>
			</div>
		</section>

		<!-- Developer -->
		<section class="section">
			<div class="section-label">
				<h2>Developer</h2>
				<p>API tokens for CLIs, scripts, and backups.</p>
			</div>
			<div class="section-body">
				<ApiTokens canCreate={canCreateTokens} authLoading={auth.loading} />
			</div>
		</section>

		<!-- Account -->
		<section class="section">
			<div class="section-label">
				<h2>Account</h2>
				<p>You.</p>
			</div>
			<div class="section-body">
				<p class="account-info">
					Logged in as <strong class="account-name">{auth.user?.username}</strong>
					<span class="account-meta">· {auth.user?.is_admin ? 'Admin' : 'User'}</span>
				</p>
			</div>
		</section>
	</div>
</div>

<style>
	/* Scrollable full-height page */
	.settings-page {
		height: 100dvh;
		overflow-y: auto;
		background: var(--bg);
		font-family: var(--sans);
	}

	.settings-inner {
		max-width: 1040px;
		margin: 0 auto;
		padding: 0 3rem;
	}

	.page-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 2rem 0 1.5rem;
		border-bottom: 1px solid var(--border);
		margin-bottom: 0;
	}

	.back-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.25rem;
		color: var(--text-3);
		text-decoration: none;
		flex-shrink: 0;
	}
	.back-btn:hover { color: var(--text); }

	.page-title {
		font-family: var(--serif);
		font-weight: 700;
		font-size: 2.125rem;
		letter-spacing: -0.04em;
		line-height: 1;
		color: var(--text);
		margin: 0;
		flex: 1;
	}
	.accent-dot { color: var(--accent); }

	.wm-small {
		font-family: var(--serif);
		font-weight: 800;
		font-size: 0.875rem;
		letter-spacing: -0.02em;
		color: rgb(122, 114, 103);
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

	/* Two-column section layout */
	.section {
		display: grid;
		grid-template-columns: 220px 1fr;
		gap: 2.5rem;
		padding: 2.25rem 0;
		border-top: 1px solid var(--border);
	}
	.first-section { border-top: none; }

	.section-label h2 {
		font-family: var(--serif);
		font-weight: 600;
		font-size: 1.375rem;
		letter-spacing: -0.02em;
		line-height: 1.1;
		color: var(--text);
		margin: 0 0 0.375rem;
	}
	.section-label p {
		font-size: 0.8125rem;
		color: var(--text-3);
		line-height: 1.5;
		margin: 0;
	}
	.section-label kbd {
		font-family: var(--mono);
		font-size: 0.75rem;
		padding: 0 0.3rem;
		border: 1px solid var(--border-md);
		background: var(--bg-hover);
		color: var(--text);
	}

	.section-body { min-width: 0; }

	.field-input {
		padding: 0.4rem 0.625rem;
		border: 1px solid var(--border-md);
		font-size: 0.875rem;
		font-family: var(--sans);
		background: var(--bg);
		color: var(--text);
		outline: none;
		flex: 1;
		min-width: 140px;
	}
	.field-input:focus { border-color: var(--accent); }

	.field-label {
		font-size: 0.6875rem;
		color: var(--text-3);
		text-transform: uppercase;
		letter-spacing: 0.07em;
		display: block;
		margin-bottom: 0.375rem;
	}

	.btn-primary {
		padding: 0.4rem 0.875rem;
		background: var(--accent);
		color: white;
		border: none;
		cursor: pointer;
		font-size: 0.875rem;
		font-family: var(--sans);
		white-space: nowrap;
	}
	.btn-primary:hover { background: var(--accent-dk); }
	.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

	.btn-default {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--text);
		font-size: 0.875rem;
		font-family: var(--sans);
		cursor: pointer;
		text-decoration: none;
	}
	.btn-default:hover { background: var(--bg-hover); }
	.btn-chevron .chevron { color: var(--text-3); }

	.export-row { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.5rem; }

	.hint { font-size: 0.8125rem; color: var(--text-3); margin: 0; line-height: 1.5; }
	.hint code { font-family: var(--mono); font-size: 0.75rem; background: var(--bg-hover); padding: 1px 5px; color: var(--text-2); }

	.pw-form { display: flex; flex-direction: column; gap: 1rem; max-width: 400px; }
	.pw-field { display: flex; flex-direction: column; gap: 0.25rem; }

	.msg-error {
		color: var(--danger);
		font-size: 0.8125rem;
		padding: 0.4rem 0.625rem;
		background: var(--danger-bg);
		border: 1px solid var(--danger-bd);
		margin: 0 0 0.5rem;
		font-family: var(--sans);
	}
	.msg-success {
		color: var(--accent);
		font-size: 0.8125rem;
		padding: 0.4rem 0.625rem;
		background: var(--accent-lt);
		margin: 0 0 0.5rem;
		font-family: var(--sans);
	}

	/* Segmented control for theme */
	.segmented {
		display: inline-flex;
		border: 1px solid var(--border-md);
	}
	.seg-btn {
		font-family: var(--sans);
		font-size: 0.8125rem;
		padding: 0.5rem 1.125rem;
		background: var(--bg);
		color: var(--text);
		border: none;
		border-left: 1px solid var(--border-md);
		cursor: pointer;
	}
	.seg-btn:first-child { border-left: none; }
	.seg-btn:hover:not(.seg-active) { background: var(--bg-hover); }
	.seg-active { background: var(--text); color: var(--bg); }

	.account-info { font-size: 0.875rem; color: var(--text); margin: 0; font-family: var(--sans); }
	.account-name { font-family: var(--serif); font-size: 1rem; font-weight: 600; }
	.account-meta { color: var(--text-3); font-size: 0.8125rem; margin-left: 0.5rem; }

	/* Responsive */
	@media (max-width: 640px) {
		.settings-inner { padding: 0 1rem; }
		.section { grid-template-columns: 1fr; gap: 0.75rem; padding: 1.5rem 0; }
	}
</style>
