<script lang="ts">
	import { ChevronLeft, ChevronRight, Users } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { auth } from '$lib/stores/auth.svelte';
	import { theme } from '$lib/stores/theme.svelte';
	import ApiTokens from '$lib/components/ApiTokens.svelte';
	import PasswordInput from '$lib/components/PasswordInput.svelte';
	import ShortcutEditor from '$lib/components/ShortcutEditor.svelte';
	import MobileTabBar from '$lib/components/MobileTabBar.svelte';
	import { api, ApiError } from '$lib/api';

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			const target = e.target as Element;
			if (!target.closest('input, textarea, [contenteditable]')) {
				void goto('/');
			}
		}
	}

	let exportPassword = $state('');
	let exportError = $state('');
	let exportSubmitting = $state(false);

	let newPassword = $state('');
	let newPasswordConfirm = $state('');
	let pwError = $state('');
	let pwSuccess = $state('');
	let pwSubmitting = $state(false);

	const canCreateTokens = $derived(
		!auth.loading && !!auth.user && (auth.user.is_admin || !!auth.user.api_tokens_enabled),
	);

	async function doExport() {
		exportError = '';
		exportSubmitting = true;
		try {
			await api.export(exportPassword || undefined);
			exportPassword = '';
		} catch (err) {
			exportError = err instanceof ApiError && err.message
				? err.message
				: 'Export failed.';
		} finally {
			exportSubmitting = false;
		}
	}

	// Required-field flags. Cleared as the user edits the field; toggled on
	// again whenever a submit attempt fails.
	let invalidNew = $state(false);
	let invalidConfirm = $state(false);

	function clearInvalid(field: 'new' | 'confirm') {
		if (field === 'new') invalidNew = false;
		else invalidConfirm = false;
	}

	async function changePassword(e: Event) {
		e.preventDefault();
		pwError = '';
		pwSuccess = '';
		invalidNew = !newPassword;
		invalidConfirm = !newPasswordConfirm;
		if (invalidNew || invalidConfirm) return;
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
			await api.auth.changePassword(newPassword);
			pwSuccess = 'Password updated.';
			newPassword = '';
			newPasswordConfirm = '';
		} catch (err) {
			if (err instanceof ApiError && err.status === 400) {
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

<svelte:window onkeydown={handleKeydown} />

<div class="settings-page">
	<a href="/" class="wordmark">Crapnote<span class="wordmark-dot" aria-hidden="true"></span></a>
	<!-- Mobile page title (outside scrollable inner so it stays fixed at top) -->
	<div class="mob-page-title-row">
		<a href="/" class="mob-back-btn" aria-label="Back to notes"><ChevronLeft size={22} /></a>
		<h1 class="mob-page-title">Settings<span class="accent-dot">.</span></h1>
	</div>
	<div class="settings-inner">
		<header class="page-header">
			<a href="/" class="back-btn" title="Back to notes" aria-label="Back to notes">
				<ChevronLeft size={20} />
			</a>
			<h1 class="page-title">Settings<span class="accent-dot" aria-hidden="true">.</span></h1>
		</header>

		<!-- Export -->
		<section class="section first-section">
			<div class="section-label">
				<h2>Export</h2>
				<p>Everything you've written, as Markdown.</p>
			</div>
			<div class="section-body">
				{#if exportError}<p role="alert" class="msg-error">{exportError}</p>{/if}
				<div class="export-row">
					<input type="password" placeholder="Password (optional)" bind:value={exportPassword} autocomplete="new-password" class="field-input" disabled={exportSubmitting} />
					<button class="btn-primary" onclick={doExport} disabled={exportSubmitting}>
						{exportSubmitting ? 'Exporting…' : 'Export notes'}
					</button>
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
				<a href="/admin" class="admin-link">
					<span class="admin-link-icon" aria-hidden="true"><Users size={18} /></span>
					<span class="admin-link-label">User management</span>
					<ChevronRight size={18} class="admin-link-chevron" aria-hidden="true" />
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
				<form class="pw-form" onsubmit={changePassword} novalidate>
					<div class="pw-field">
						<label for="new-password" class="field-label">New password</label>
						<PasswordInput
							id="new-password"
							autocomplete="new-password"
							bind:value={newPassword}
							disabled={pwSubmitting}
							invalid={invalidNew}
							oninput={() => clearInvalid('new')}
						/>
					</div>
					<div class="pw-field">
						<label for="new-password-confirm" class="field-label">Confirm new password</label>
						<PasswordInput
							id="new-password-confirm"
							autocomplete="new-password"
							bind:value={newPasswordConfirm}
							disabled={pwSubmitting}
							invalid={invalidConfirm}
							oninput={() => clearInvalid('confirm')}
						/>
					</div>
					<button type="submit" class="btn-primary" disabled={pwSubmitting}>
						{pwSubmitting ? 'Updating…' : 'Update password'}
					</button>
				</form>
			</div>
		</section>

		<!-- Keyboard shortcuts (hidden on mobile) -->
		<section class="section section-keyboard-shortcuts">
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
				<label class="theme-toggle-row">
					<input
						type="checkbox"
						role="switch"
						aria-label="Dark mode"
						checked={theme.current === 'dark'}
						onchange={() => theme.toggle()}
					/>
					<span class="toggle-track" aria-hidden="true"><span class="toggle-thumb"></span></span>
					<span class="toggle-text">Dark mode</span>
				</label>
			</div>
		</section>

		<!-- Developer -->
		<section class="section section-developer">
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

		<!-- Mobile footer -->
		<p class="mob-settings-footer">Crapnote · {auth.user?.username ?? ''}</p>
	</div>
	<MobileTabBar activeTab="settings" />
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

	.wordmark {
		position: fixed;
		top: 1.25rem;
		left: 1.25rem;
		z-index: 10;
		font-family: var(--serif);
		font-weight: 800;
		font-size: 1.5rem;
		letter-spacing: -0.04em;
		line-height: 1;
		color: var(--text);
		text-decoration: none;
		display: inline-flex;
		align-items: baseline;
	}
	.wordmark:hover { opacity: 0.8; }
	.wordmark-dot {
		display: inline-block;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--accent);
		margin-left: 3px;
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
		width: 260px;
		max-width: 100%;
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

	.admin-link {
		display: inline-flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.5rem 0.75rem 0.5rem 0.625rem;
		border: 1px solid var(--border-md);
		background: var(--bg);
		color: var(--text);
		font-size: 0.875rem;
		font-family: var(--sans);
		cursor: pointer;
		text-decoration: none;
		transition: border-color 0.15s, background 0.15s;
	}
	.admin-link:hover {
		background: var(--bg-hover);
		border-color: var(--accent);
	}
	.admin-link-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--accent);
	}
	.admin-link-label { font-weight: 500; }
	:global(.admin-link-chevron) { color: var(--text-3); }

	.export-row { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.5rem; }

	/* Dark mode toggle switch */
	.theme-toggle-row {
		display: inline-flex;
		align-items: center;
		gap: 0.625rem;
		cursor: pointer;
		user-select: none;
	}
	.theme-toggle-row input[type="checkbox"] { position: absolute; opacity: 0; width: 0; height: 0; }
	.toggle-track {
		position: relative;
		width: 2.25rem;
		height: 1.25rem;
		border-radius: 9999px;
		background: var(--border-md);
		flex-shrink: 0;
		transition: background 0.15s;
	}
	.theme-toggle-row input:checked ~ .toggle-track { background: var(--accent); }
	.toggle-thumb {
		position: absolute;
		top: 0.1875rem;
		left: 0.1875rem;
		width: 0.875rem;
		height: 0.875rem;
		border-radius: 50%;
		background: white;
		transition: transform 0.15s;
	}
	.theme-toggle-row input:checked ~ .toggle-track .toggle-thumb { transform: translateX(1rem); }
	.toggle-text { font-size: 0.875rem; color: var(--text); font-family: var(--sans); }

	.hint { font-size: 0.8125rem; color: var(--text-3); margin: 0; line-height: 1.5; }
	.hint code { font-family: var(--mono); font-size: 0.75rem; background: var(--bg-hover); padding: 1px 5px; color: var(--text-2); }

	.pw-form { display: flex; flex-direction: column; gap: 1rem; max-width: 320px; }
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

.account-info { font-size: 0.875rem; color: var(--text); margin: 0; font-family: var(--sans); }
	.account-name { font-family: var(--serif); font-size: 1rem; font-weight: 600; }
	.account-meta { color: var(--text-3); font-size: 0.8125rem; margin-left: 0.5rem; }

	/* Desktop: hide mobile-only elements */
	.mob-page-title-row { display: none; }
	.mob-settings-footer { display: none; }

	/* Responsive */
	@media (max-width: 640px) {
		.settings-page {
			display: flex;
			flex-direction: column;
			height: 100dvh;
			overflow: hidden;
		}

		/* Scrollable content area */
		.settings-inner {
			padding: 0;
			flex: 1;
			overflow-y: scroll;
		}

		/* Hide desktop wordmark (overlaps on mobile) */
		.wordmark { display: none; }

		/* Hide desktop page header layout (back btn + title in a row) */
		.page-header { display: none; }

		/* Mobile top bar: back chevron + title */
		.mob-page-title-row {
			display: flex;
			align-items: center;
			gap: 0.25rem;
			padding: calc(env(safe-area-inset-top, 0px) + 14px) 20px 12px;
			background: var(--bg-alt);
			flex-shrink: 0;
		}
		.mob-back-btn {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 36px;
			height: 36px;
			color: var(--text-3);
			text-decoration: none;
			flex-shrink: 0;
			margin-left: -8px;
			margin-right: 2px;
		}
		.mob-back-btn:hover { color: var(--text); }
		.mob-page-title {
			font-family: var(--serif);
			font-size: 26px;
			font-weight: 700;
			color: var(--text);
			margin: 0;
			line-height: 1;
		}

		/* Sections: single column with side padding */
		.section { grid-template-columns: 1fr; gap: 0; padding: 14px 16px 12px; }
		.first-section { padding-top: 14px; border-top: none; }

		/* Section label */
		.section-label p { display: none; }
		.section-label h2 {
			font-size: 13px;
			font-weight: 600;
			text-transform: uppercase;
			letter-spacing: 0.06em;
			color: var(--text-3);
			margin-bottom: 6px;
			font-family: var(--sans);
		}

		/* Section body: card appearance */
		.section-body {
			background: var(--bg-alt);
			border-radius: 14px;
			padding: 2px 0;
			overflow: hidden;
		}

		/* Keyboard shortcuts and developer section — hide on mobile (desktop-only content) */
		.section-keyboard-shortcuts { display: none; }
		.section-developer { display: none; }

		/* Account info: add touch-friendly padding inside card */
		.account-info { padding: 14px 16px; font-size: 15px; }

		/* Export row: flat input row, then button with breathing room */
		.export-row { flex-direction: column; gap: 0; padding: 0; }
		.export-row .field-input {
			border: none;
			border-bottom: 1px solid var(--border);
			border-radius: 0;
			background: transparent;
			padding: 14px 16px;
			font-size: 16px;
			width: 100%;
			box-sizing: border-box;
			outline: none;
		}
		.export-row .btn-primary { margin: 12px 16px 0; width: calc(100% - 32px); box-sizing: border-box; }
		.hint { padding: 8px 16px 14px; }

		/* Buttons full-width on mobile */
		.btn-primary { width: 100%; box-sizing: border-box; padding: 13px 16px; font-size: 16px; border-radius: 10px; }
		.admin-link {
			display: flex;
			align-items: center;
			gap: 12px;
			width: 100%;
			box-sizing: border-box;
			padding: 14px 16px;
			background: none;
			border: none;
			font-size: 16px;
			color: var(--text);
			min-height: 48px;
			text-decoration: none;
			border-radius: 0;
		}
		.admin-link-label { flex: 1; }
		.field-input { width: 100%; border-radius: 0; padding: 14px 16px; font-size: 16px; border: none; border-bottom: 1px solid var(--border); background: transparent; outline: none; box-sizing: border-box; }
		.field-input:focus { border-bottom-color: var(--accent); }

		/* Theme toggle row: full-width list item */
		.theme-toggle-row {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 14px 16px;
			min-height: 48px;
			width: 100%;
			box-sizing: border-box;
		}

		/* Dark mode toggle: make it larger */
		.toggle-track { width: 46px; height: 28px; border-radius: 14px; }
		.toggle-thumb { width: 24px; height: 24px; top: 2px; left: 2px; }
		.theme-toggle-row input:checked ~ .toggle-track .toggle-thumb { transform: translateX(18px); }
		.toggle-text { font-size: 16px; }

		/* PasswordInput: flat borderless rows inside card */
		.section :global(.pw-wrap) { width: 100%; }
		.section :global(.pw-wrap input) {
			border: none;
			border-radius: 0;
			background: transparent;
			padding: 6px 2.75rem 12px 16px;
			font-size: 16px;
			box-sizing: border-box;
			width: 100%;
			outline: none;
		}
		.section :global(.pw-wrap .toggle) { right: 12px; }

		/* Password fields: flat rows with bottom separator */
		.pw-form { max-width: none; gap: 0; }
		.pw-field {
			display: flex;
			flex-direction: column;
			gap: 0;
			padding: 0;
			border-bottom: 1px solid var(--border);
		}
		.field-label { font-size: 11px; color: var(--text-4); margin-bottom: 0; display: block; padding: 12px 16px 4px; text-transform: uppercase; letter-spacing: 0.06em; }
		.pw-form .btn-primary { margin: 12px 16px; width: calc(100% - 32px); box-sizing: border-box; }

		/* Mobile footer */
		.mob-settings-footer {
			display: block;
			text-align: center;
			font-family: var(--sans);
			font-size: 12px;
			color: var(--text-3);
			padding: 24px 22px 8px;
			margin: 0;
		}
	}
</style>
