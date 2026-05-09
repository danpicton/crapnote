<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronLeft, ChevronRight, UserPlus, Trash2, Lock, LockOpen, KeyRound, Mail, Copy, Check } from 'lucide-svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import PasswordInput from '$lib/components/PasswordInput.svelte';
	import PasswordPromptModal from '$lib/components/PasswordPromptModal.svelte';
	import MobileTabBar from '$lib/components/MobileTabBar.svelte';
	import { api, ApiError, type InviteResult } from '$lib/api';

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			const target = e.target as Element;
			if (!target.closest('input, textarea, [contenteditable]')) {
				void goto('/settings');
			}
		}
	}

	interface AdminUser {
		id: number;
		username: string;
		is_admin: boolean;
		api_tokens_enabled: boolean;
		locked: boolean;
		locked_at?: string;
		pending_setup?: boolean;
		created_at: string;
	}

	type CreateMode = 'password' | 'invite';

	let users = $state<AdminUser[]>([]);
	let loading = $state(true);
	let newUsername = $state('');
	let newPassword = $state('');
	let newPasswordConfirm = $state('');
	let newIsAdmin = $state(false);
	let createMode = $state<CreateMode>('password');
	let createError = $state('');

	let passwordModalUser = $state<AdminUser | null>(null);
	let passwordModalSubmitting = $state(false);
	let passwordModalError = $state('');

	let expandedUser = $state<number | null>(null);

	// Result of the most recent invite issuance, so the admin can copy the URL.
	let lastInvite = $state<InviteResult | null>(null);
	let copied = $state(false);

	onMount(async () => {
		if (!auth.user?.is_admin) {
			goto('/');
			return;
		}
		await loadUsers();
	});

	async function loadUsers() {
		const res = await fetch('/api/admin/users', { credentials: 'include' });
		if (res.ok) {
			users = await res.json();
		}
		loading = false;
	}

	async function createUser(e: Event) {
		e.preventDefault();
		createError = '';

		if (createMode === 'password') {
			if (newPassword.length < 12) {
				createError = 'Password must be at least 12 characters.';
				return;
			}
			if (newPassword !== newPasswordConfirm) {
				createError = 'Passwords do not match.';
				return;
			}
			const res = await fetch('/api/admin/users', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ username: newUsername, password: newPassword, is_admin: newIsAdmin }),
			});
			if (res.ok) {
				resetCreateForm();
				await loadUsers();
			} else {
				const text = await res.text();
				createError = text || 'Failed to create user.';
			}
			return;
		}

		// Invite mode — admin shares a setup link with the new user.
		try {
			const result = await api.admin.inviteUser(newUsername, newIsAdmin);
			lastInvite = result;
			copied = false;
			resetCreateForm();
			await loadUsers();
		} catch (err) {
			createError =
				err instanceof ApiError
					? err.message || 'Failed to create invite.'
					: 'Failed to create invite.';
		}
	}

	function resetCreateForm() {
		newUsername = '';
		newPassword = '';
		newPasswordConfirm = '';
		newIsAdmin = false;
	}

	async function copySetupURL() {
		if (!lastInvite) return;
		try {
			await navigator.clipboard.writeText(lastInvite.setup_url);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// Clipboard API unavailable — leave the URL visible for manual copy.
		}
	}

	async function resendInvite(user: AdminUser) {
		try {
			const result = await api.admin.regenerateInvite(user.id);
			lastInvite = result;
			copied = false;
			await loadUsers();
		} catch {
			alert('Failed to generate setup link.');
		}
	}

	async function deleteUser(id: number) {
		if (!confirm('Delete this user?')) return;
		await fetch(`/api/admin/users/${id}`, { method: 'DELETE', credentials: 'include' });
		users = users.filter((u) => u.id !== id);
	}

	async function toggleApiTokens(user: AdminUser, enabled: boolean) {
		const res = await fetch(`/api/admin/users/${user.id}/api-tokens`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({ enabled }),
		});
		if (res.ok) {
			const updated = (await res.json()) as AdminUser;
			users = users.map((u) => (u.id === updated.id ? updated : u));
		} else {
			alert('Failed to update API token permission.');
		}
	}

	async function toggleLock(user: AdminUser) {
		const action = user.locked ? 'unlock' : 'lock';
		const res = await fetch(`/api/admin/users/${user.id}/${action}`, {
			method: 'POST',
			credentials: 'include',
		});
		if (res.ok) {
			const updated = (await res.json()) as AdminUser;
			users = users.map((u) => (u.id === updated.id ? updated : u));
		} else {
			alert(`Failed to ${action} user.`);
		}
	}

	function openPasswordModal(user: AdminUser) {
		passwordModalUser = user;
		passwordModalError = '';
	}

	function closePasswordModal() {
		passwordModalUser = null;
		passwordModalSubmitting = false;
	}

	async function submitPasswordChange(password: string) {
		if (!passwordModalUser) return;
		passwordModalSubmitting = true;
		passwordModalError = '';
		try {
			const res = await fetch(`/api/admin/users/${passwordModalUser.id}/password`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ password }),
			});
			if (!res.ok) {
				const text = await res.text();
				passwordModalError = text || 'Failed to set password.';
				return;
			}
			closePasswordModal();
			// Server also clears the lock on a password reset; refresh the list.
			await loadUsers();
		} finally {
			passwordModalSubmitting = false;
		}
	}
</script>

<svelte:head>
	<title>User Management — Crapnote</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<div class="admin-page">
	<a href="/" class="wordmark">Crapnote<span class="wordmark-dot" aria-hidden="true"></span></a>
	<!-- Mobile page title (outside scrollable inner so it stays fixed at top) -->
	<div class="mob-page-title-row">
		<a href="/settings" class="mob-back-btn" aria-label="Back to settings">
			<ChevronLeft size={22} />
		</a>
		<h1 class="mob-page-title">Users<span class="accent-dot">.</span></h1>
	</div>
	<div class="admin-inner">
		<header class="page-header">
			<a href="/settings" class="back-btn" title="Back to settings" aria-label="Back to settings">
				<ChevronLeft size={20} />
			</a>
			<h1 class="page-title">User management<span class="accent-dot" aria-hidden="true">.</span></h1>
		</header>

		<!-- Create user -->
		<section class="section first-section">
			<div class="section-label">
				<h2>Create user</h2>
				<p>Add someone to this Crapnote instance.</p>
			</div>
			<div class="section-body">
				{#if createError}
					<p role="alert" class="msg-error">{createError}</p>
				{/if}

				<fieldset class="mode-toggle" aria-label="How to create this user">
					<label class="radio-label">
						<input type="radio" name="create-mode" value="password" bind:group={createMode} />
						Set password now
					</label>
					<label class="radio-label">
						<input type="radio" name="create-mode" value="invite" bind:group={createMode} />
						Send setup link
					</label>
				</fieldset>

				<form onsubmit={createUser} class="create-form">
					<div class="fields-row">
						<input type="text" placeholder="Username" bind:value={newUsername} required class="field-input" />
						{#if createMode === 'password'}
							<PasswordInput
								id="new-user-password"
								placeholder="Password"
								autocomplete="new-password"
								bind:value={newPassword}
								required
							/>
							<PasswordInput
								id="new-user-password-confirm"
								placeholder="Confirm password"
								autocomplete="new-password"
								bind:value={newPasswordConfirm}
								required
							/>
						{/if}
					</div>
					<div class="form-actions">
						<label class="checkbox-label">
							<input type="checkbox" bind:checked={newIsAdmin} />
							Admin
						</label>
						<button
							type="submit"
							class="btn-primary"
							title={createMode === 'invite' ? 'Send setup link' : 'Create user'}
							aria-label={createMode === 'invite' ? 'Send setup link' : 'Create user'}
						>
							{#if createMode === 'invite'}
								<Mail size={14} /> Send setup link
							{:else}
								<UserPlus size={14} /> Create user
							{/if}
						</button>
					</div>
				</form>

				{#if lastInvite}
					<div class="invite-result" role="status">
						<p class="invite-msg">
							Setup link for <strong>{lastInvite.user.username}</strong> — share this with them.
							Expires {new Date(lastInvite.expires_at).toLocaleString()}.
						</p>
						<div class="invite-url">
							<code>{lastInvite.setup_url}</code>
							<button type="button" class="copy-btn" onclick={copySetupURL} aria-label="Copy setup link">
								{#if copied}
									<Check size={13} /> Copied
								{:else}
									<Copy size={13} /> Copy
								{/if}
							</button>
						</div>
						<button type="button" class="dismiss-btn" onclick={() => (lastInvite = null)}>
							Dismiss
						</button>
					</div>
				{/if}
			</div>
		</section>

		<!-- Users table -->
		<section class="section">
			<div class="section-label">
				<h2>Users</h2>
				<p>Everyone with access to this instance.</p>
			</div>
			<div class="section-body">
				{#if loading}
					<p class="loading-msg">Loading…</p>
				{:else}
					<!-- Desktop table -->
					<table class="users-table desk-table">
						<thead>
							<tr>
								<th>Username</th>
								<th>Role</th>
								<th>Status</th>
								<th>API tokens</th>
								<th>Created</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							{#each users as user (user.id)}
								<tr class:locked-row={user.locked}>
									<td class="col-username">{user.username}</td>
									<td class="col-role">{user.is_admin ? 'Admin' : 'User'}</td>
									<td class="col-status">
										{#if user.locked}
											<span class="status-pill locked-pill">Locked</span>
										{:else if user.pending_setup}
											<span class="status-pill pending-pill">Pending</span>
										{:else}
											<span class="status-pill active-pill">Active</span>
										{/if}
									</td>
									<td class="col-api">
										{#if user.is_admin}
											<span class="muted">Always</span>
										{:else}
											<label class="toggle-label">
												<input
													type="checkbox"
													checked={user.api_tokens_enabled}
													onchange={(e) => toggleApiTokens(user, (e.currentTarget as HTMLInputElement).checked)}
												/>
												{user.api_tokens_enabled ? 'Enabled' : 'Disabled'}
											</label>
										{/if}
									</td>
									<td class="col-date">{new Date(user.created_at).toLocaleDateString()}</td>
									<td class="col-actions">
										<button
											class="icon-btn icon-key"
											onclick={() => openPasswordModal(user)}
											title="Set password for {user.username}"
											aria-label="Set password for {user.username}"
										>
											<KeyRound size={14} />
										</button>
										<button
											class="icon-btn icon-mail"
											onclick={() => resendInvite(user)}
											title="Send {user.pending_setup ? 'a new' : 'a'} setup link to {user.username}"
											aria-label="Send setup link to {user.username}"
										>
											<Mail size={14} />
										</button>
										{#if user.id !== auth.user?.id}
											<button
												class="icon-btn icon-lock"
												onclick={() => toggleLock(user)}
												title={user.locked ? `Unlock ${user.username}` : `Lock ${user.username}`}
												aria-label={user.locked ? `Unlock ${user.username}` : `Lock ${user.username}`}
											>
												{#if user.locked}
													<LockOpen size={14} />
												{:else}
													<Lock size={14} />
												{/if}
											</button>
											<button
												class="icon-btn icon-delete"
												onclick={() => deleteUser(user.id)}
												title="Delete user"
												aria-label="Delete user"
											>
												<Trash2 size={14} />
											</button>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>

					<!-- Mobile user cards (redesigned to match wireframe) -->
					<ul class="mob-user-list">
						{#each users as user (user.id)}
							<li class="mob-user-item" class:mob-user-expanded={expandedUser === user.id}>
								<button
									class="mob-user-row"
									onclick={() => expandedUser = expandedUser === user.id ? null : user.id}
									aria-expanded={expandedUser === user.id}
								>
									<div class="mob-user-avatar" aria-hidden="true">{user.username.charAt(0).toUpperCase()}</div>
									<div class="mob-user-info">
										<div class="mob-user-name-row">
											<span class="mob-user-name">{user.username}</span>
											{#if user.locked}
												<span class="mob-status-pill mob-status-locked">Locked</span>
											{:else if user.pending_setup}
												<span class="mob-status-pill mob-status-invited">Invited</span>
											{:else}
												<span class="mob-status-pill mob-status-active">Active</span>
											{/if}
										</div>
										<span class="mob-user-sub">
											{user.is_admin ? 'Admin' : 'User'}
											· {user.is_admin ? 'Always' : (user.api_tokens_enabled ? 'API on' : '—')}
											· {new Date(user.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}
										</span>
									</div>
									<ChevronRight size={16} class="mob-user-chevron" aria-hidden="true" />
								</button>
								{#if expandedUser === user.id}
									<div class="mob-user-actions">
										<button class="mob-user-action-btn" onclick={() => openPasswordModal(user)}>
											<KeyRound size={15} /> Set password
										</button>
										<button class="mob-user-action-btn" onclick={() => resendInvite(user)}>
											<Mail size={15} /> {user.pending_setup ? 'Resend invite' : 'Send setup link'}
										</button>
										{#if !user.is_admin}
											<button class="mob-user-action-btn" onclick={() => toggleApiTokens(user, !user.api_tokens_enabled)}>
												{user.api_tokens_enabled ? 'Disable API' : 'Enable API'}
											</button>
										{/if}
										{#if user.id !== auth.user?.id}
											<button class="mob-user-action-btn" onclick={() => toggleLock(user)}>
												{#if user.locked}<LockOpen size={15} /> Unlock{:else}<Lock size={15} /> Lock{/if}
											</button>
											<button class="mob-user-action-btn mob-user-action-danger" onclick={() => deleteUser(user.id)}>
												<Trash2 size={15} /> Delete
											</button>
										{/if}
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</section>
	</div>
	<MobileTabBar activeTab="settings" />
</div>

<PasswordPromptModal
	open={passwordModalUser != null}
	title={passwordModalUser ? `Set password for ${passwordModalUser.username}` : ''}
	submitting={passwordModalSubmitting}
	externalError={passwordModalError}
	onsubmit={submitPasswordChange}
	oncancel={closePasswordModal}
/>

<style>
	.admin-page {
		height: 100dvh;
		overflow-y: auto;
		background: var(--bg);
		font-family: var(--sans);
	}

	.admin-inner {
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

	.section-body { min-width: 0; overflow-x: auto; }

	.msg-error {
		color: var(--danger);
		font-size: 0.8125rem;
		padding: 0.4rem 0.625rem;
		background: var(--danger-bg);
		border: 1px solid var(--danger-bd);
		margin: 0 0 0.75rem;
		font-family: var(--sans);
	}

	.mode-toggle {
		display: flex;
		gap: 1.25rem;
		border: none;
		padding: 0;
		margin: 0 0 0.875rem;
		font-size: 0.8125rem;
		color: var(--text-2);
	}
	.radio-label {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		cursor: pointer;
	}

	.create-form { display: flex; flex-direction: column; gap: 0.625rem; max-width: 320px; }
	.fields-row {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.form-actions {
		display: flex;
		gap: 0.75rem;
		align-items: center;
	}

	.field-input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.4rem 0.625rem;
		border: 1px solid var(--border-md);
		font-size: 0.875rem;
		font-family: var(--sans);
		background: var(--bg);
		color: var(--text);
		outline: none;
	}
	.field-input:focus { border-color: var(--accent); }

	/* Override PasswordInput inside the create form to match field-input sizing */
	.fields-row :global(.pw-wrap) { width: 100%; }
	.fields-row :global(.pw-wrap input) {
		font-size: 0.875rem;
		padding: 0.4rem 2rem 0.4rem 0.625rem;
		border-radius: 0;
		box-sizing: border-box;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.875rem;
		color: var(--text-2);
		cursor: pointer;
	}

	.btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
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

	.invite-result {
		margin-top: 1rem;
		padding: 0.75rem 0.875rem;
		border: 1px solid var(--accent);
		background: var(--accent-lt);
		font-size: 0.875rem;
	}
	.invite-msg { margin: 0 0 0.5rem; }

	.invite-url {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.5rem;
		background: var(--bg);
		border: 1px solid var(--border);
		overflow: auto;
	}
	.invite-url code {
		flex: 1;
		word-break: break-all;
		font-size: 0.8125rem;
		font-family: var(--mono);
	}

	.copy-btn, .dismiss-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.5rem;
		border: 1px solid var(--border-md);
		background: var(--bg);
		color: var(--text-2);
		font-size: 0.75rem;
		font-family: var(--sans);
		cursor: pointer;
		white-space: nowrap;
	}
	.copy-btn:hover, .dismiss-btn:hover { background: var(--bg-hover); color: var(--text); }
	.dismiss-btn { margin-top: 0.5rem; }

	.loading-msg { font-size: 0.875rem; color: var(--text-3); margin: 0; }

	.users-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8125rem;
	}

	.users-table th {
		text-align: left;
		padding: 0.3rem 0.5rem;
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--text-3);
		text-transform: uppercase;
		letter-spacing: 0.07em;
		border-bottom: 1px solid var(--border-md);
		white-space: nowrap;
	}
	.users-table td {
		padding: 0.5rem 0.5rem;
		border-bottom: 1px solid var(--border);
		color: var(--text);
		vertical-align: middle;
		white-space: nowrap;
	}

	.locked-row td { opacity: 0.65; }

	.col-username { font-family: var(--serif); font-size: 0.9375rem; font-weight: 500; max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
	.col-role { color: var(--text-3); }
	.col-date { color: var(--text-3); font-size: 0.8125rem; }
	.col-actions { white-space: nowrap; }

	.status-pill {
		display: inline-block;
		padding: 0.125rem 0.5rem;
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.locked-pill { background: var(--danger-bg); color: var(--danger); border: 1px solid var(--danger-bd); }
	.active-pill { background: var(--bg-hover); color: var(--text-3); border: 1px solid var(--border); }
	.pending-pill { background: var(--accent-lt); color: var(--accent-tx); border: 1px solid var(--accent); }

	.toggle-label {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.8125rem;
		color: var(--text-2);
		cursor: pointer;
	}

	.muted { font-size: 0.8125rem; color: var(--text-4); }

	.col-actions { display: flex; gap: 0.125rem; align-items: center; }

	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.875rem;
		height: 1.875rem;
		border: none;
		cursor: pointer;
		background: transparent;
		color: var(--text-3);
	}
	.icon-btn:hover { background: var(--bg-hover); color: var(--text); }
	.icon-key { color: var(--accent); }
	.icon-key:hover { background: var(--accent-lt); color: var(--accent-dk); }
	.icon-delete { color: var(--danger); }
	.icon-delete:hover { background: var(--danger-bg); }

	/* ── Mobile-only elements (hidden on desktop) ── */
	.mob-page-title-row,
	.mob-user-list { display: none; }

	@media (max-width: 640px) {
		.admin-page { display: flex; flex-direction: column; overflow: hidden; }
		.admin-inner { padding: 0; padding-bottom: 80px; flex: 1; overflow-y: scroll; }

		/* Hide desktop-only elements */
		.wordmark, .page-header { display: none !important; }
		.desk-table { display: none !important; }

		/* Mobile page title */
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
			font-weight: 700;
			font-size: 26px;
			line-height: 1;
			color: var(--text);
			margin: 0;
		}

		/* Sections: match settings layout exactly */
		.section { grid-template-columns: 1fr; gap: 0; padding: 14px 16px 12px; border-top: 1px solid var(--border); }
		.first-section { padding-top: 14px; border-top: none; }
		.section-label h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); margin-bottom: 6px; font-family: var(--sans); }
		.section-label p { display: none; }

		/* Section body: card appearance */
		.section-body {
			background: var(--bg-alt);
			border-radius: 14px;
			padding: 2px 0;
			overflow: hidden;
		}

		/* Create form: flat rows inside card */
		.create-form { max-width: none; padding: 0; }
		.fields-row { gap: 0; }
		.fields-row .field-input {
			border: none !important;
			border-bottom: 1px solid var(--border) !important;
			border-radius: 0 !important;
			background: transparent !important;
			-webkit-appearance: none;
			appearance: none;
			padding: 14px 16px;
			font-size: 16px;
			width: 100%;
			box-sizing: border-box;
			outline: none;
		}
		/* PasswordInput inside create form: flat rows */
		.fields-row :global(.pw-wrap) { width: 100%; border-bottom: 1px solid var(--border); }
		.fields-row :global(.pw-wrap input) {
			border: none !important;
			border-radius: 0 !important;
			background: transparent !important;
			-webkit-appearance: none;
			appearance: none;
			padding: 14px 2.75rem 14px 16px;
			font-size: 16px;
			width: 100%;
			box-sizing: border-box;
			outline: none;
		}
		.fields-row :global(.pw-wrap .toggle) { right: 12px; }

		.form-actions { flex-direction: column; gap: 0; padding: 12px 16px; }
		.checkbox-label { font-size: 15px; padding: 4px 0 12px; }
		.btn-primary { width: 100%; justify-content: center; padding: 13px; border-radius: 10px; font-size: 16px; }

		/* Segmented radio control for mode-toggle */
		.mode-toggle {
			display: flex;
			gap: 0;
			border: 1px solid var(--border);
			border-radius: 10px;
			overflow: hidden;
			padding: 0;
			margin: 12px 16px;
		}
		.radio-label {
			flex: 1;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 10px 8px;
			font-size: 12px;
			cursor: pointer;
			background: none;
			border-right: 1px solid var(--border);
			text-align: center;
		}
		.radio-label:last-child { border-right: none; }
		.radio-label:has(input:checked) {
			background: var(--accent);
			color: white;
			font-weight: 600;
		}
		.radio-label input { display: none; }

		/* Mobile user list (new card design) */
		.mob-user-list {
			display: flex;
			flex-direction: column;
			list-style: none;
			margin: 0;
			padding: 0;
			background: var(--bg-alt);
			border-radius: 14px;
			overflow: hidden;
		}
		.mob-user-item {
			border-bottom: 1px solid var(--border);
		}
		.mob-user-item:last-child { border-bottom: none; }
		.mob-user-row {
			display: flex;
			align-items: center;
			gap: 12px;
			padding: 12px 16px;
			width: 100%;
			background: none;
			border: none;
			cursor: pointer;
			text-align: left;
			min-height: 64px;
			box-sizing: border-box;
		}
		.mob-user-avatar {
			width: 40px;
			height: 40px;
			border-radius: 50%;
			background: var(--bg-hover);
			color: var(--text-2);
			display: flex;
			align-items: center;
			justify-content: center;
			font-family: var(--serif);
			font-weight: 700;
			font-size: 18px;
			flex-shrink: 0;
		}
		.mob-user-info {
			flex: 1;
			min-width: 0;
			display: flex;
			flex-direction: column;
			gap: 2px;
		}
		.mob-user-name-row {
			display: flex;
			align-items: center;
			gap: 6px;
			flex-wrap: nowrap;
		}
		.mob-user-name {
			font-family: var(--sans);
			font-weight: 600;
			font-size: 15px;
			color: var(--text);
		}
		.mob-status-pill {
			font-size: 10px;
			font-weight: 700;
			text-transform: uppercase;
			letter-spacing: 0.06em;
			padding: 2px 7px;
			border-radius: 999px;
			flex-shrink: 0;
		}
		.mob-status-active { background: var(--bg-hover); color: var(--text-3); }
		.mob-status-invited { background: var(--accent-lt); color: var(--accent); border: 1px solid var(--accent); }
		.mob-status-locked { background: var(--danger-bg); color: var(--danger); border: 1px solid var(--danger-bd); }
		.mob-user-sub {
			font-size: 12px;
			color: var(--text-3);
			font-family: var(--sans);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.mob-user-actions {
			display: flex;
			flex-direction: column;
			background: var(--bg);
			border-top: 1px solid var(--border);
		}
		.mob-user-action-btn {
			display: flex;
			align-items: center;
			gap: 10px;
			padding: 13px 20px;
			background: none;
			border: none;
			border-bottom: 1px solid var(--border);
			font-size: 15px;
			font-family: var(--sans);
			color: var(--text);
			cursor: pointer;
			text-align: left;
			min-height: 48px;
			box-sizing: border-box;
		}
		.mob-user-action-btn:last-child { border-bottom: none; }
		.mob-user-action-btn:hover { background: var(--bg-hover); }
		.mob-user-action-danger { color: var(--danger); }

		:global(.mob-user-chevron) {
			color: var(--text-4);
			flex-shrink: 0;
			transition: transform 200ms;
		}
		.mob-user-expanded :global(.mob-user-chevron) {
			transform: rotate(90deg);
		}

		/* Invite result */
		.invite-result { font-size: 0.8125rem; }
		.invite-url { flex-wrap: wrap; }
	}

	@media (min-width: 641px) {
		.mob-page-title-row,
		.mob-user-list { display: none !important; }
	}
</style>
