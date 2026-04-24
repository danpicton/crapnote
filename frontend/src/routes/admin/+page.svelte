<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronLeft, UserPlus, Trash2, Lock, LockOpen, Key, Mail, Copy, Check } from 'lucide-svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import PasswordInput from '$lib/components/PasswordInput.svelte';
	import PasswordPromptModal from '$lib/components/PasswordPromptModal.svelte';
	import { api, ApiError, type InviteResult } from '$lib/api';

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

<div class="page">
	<header class="page-header">
		<a href="/settings" class="back-btn" title="Back to settings" aria-label="Back to settings">
			<ChevronLeft size={20} />
		</a>
		<h1>User management</h1>
	</header>

	<section class="create-section">
		<h2>Create user</h2>
		{#if createError}
			<p role="alert" class="error">{createError}</p>
		{/if}

		<fieldset class="mode-toggle" aria-label="How to create this user">
			<label>
				<input type="radio" name="create-mode" value="password" bind:group={createMode} />
				Set password now
			</label>
			<label>
				<input type="radio" name="create-mode" value="invite" bind:group={createMode} />
				Send setup link
			</label>
		</fieldset>

		<form onsubmit={createUser} class="create-form">
			<input type="text" placeholder="Username" bind:value={newUsername} required />
			{#if createMode === 'password'}
				<div class="pw-field">
					<PasswordInput
						id="new-user-password"
						placeholder="Password"
						autocomplete="new-password"
						bind:value={newPassword}
						required
					/>
				</div>
				<div class="pw-field">
					<PasswordInput
						id="new-user-password-confirm"
						placeholder="Confirm password"
						autocomplete="new-password"
						bind:value={newPasswordConfirm}
						required
					/>
				</div>
			{/if}
			<label class="checkbox-label">
				<input type="checkbox" bind:checked={newIsAdmin} />
				Admin
			</label>
			<button
				type="submit"
				class="create-btn"
				title={createMode === 'invite' ? 'Send setup link' : 'Create user'}
				aria-label={createMode === 'invite' ? 'Send setup link' : 'Create user'}
			>
				{#if createMode === 'invite'}
					<Mail size={16} /> Send setup link
				{:else}
					<UserPlus size={16} /> Create user
				{/if}
			</button>
		</form>

		{#if lastInvite}
			<div class="invite-result" role="status">
				<p>
					Setup link for <strong>{lastInvite.user.username}</strong> — share this with them.
					It expires on {new Date(lastInvite.expires_at).toLocaleString()}.
				</p>
				<div class="invite-url">
					<code>{lastInvite.setup_url}</code>
					<button type="button" class="copy-btn" onclick={copySetupURL} aria-label="Copy setup link">
						{#if copied}
							<Check size={14} /> Copied
						{:else}
							<Copy size={14} /> Copy
						{/if}
					</button>
				</div>
				<button type="button" class="dismiss-btn" onclick={() => (lastInvite = null)}>
					Dismiss
				</button>
			</div>
		{/if}
	</section>

	<section class="users-section">
		<h2>Users</h2>
		{#if loading}
			<p>Loading…</p>
		{:else}
			<table class="users-table">
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
							<td>{user.username}</td>
							<td>{user.is_admin ? 'Admin' : 'User'}</td>
							<td>
								{#if user.locked}
									<span class="status locked-pill">Locked</span>
								{:else if user.pending_setup}
									<span class="status pending-pill">Pending setup</span>
								{:else}
									<span class="status active-pill">Active</span>
								{/if}
							</td>
							<td>
								{#if user.is_admin}
									<span class="hint">Always</span>
								{:else}
									<label class="toggle">
										<input
											type="checkbox"
											checked={user.api_tokens_enabled}
											onchange={(e) => toggleApiTokens(user, (e.currentTarget as HTMLInputElement).checked)}
										/>
										{user.api_tokens_enabled ? 'Enabled' : 'Disabled'}
									</label>
								{/if}
							</td>
							<td>{new Date(user.created_at).toLocaleDateString()}</td>
							<td class="actions">
								<button
									class="icon-btn key"
									onclick={() => openPasswordModal(user)}
									title="Set password for {user.username}"
									aria-label="Set password for {user.username}"
								>
									<Key size={14} />
								</button>
								<button
									class="icon-btn mail"
									onclick={() => resendInvite(user)}
									title="Send {user.pending_setup ? 'a new' : 'a'} setup link to {user.username}"
									aria-label="Send setup link to {user.username}"
								>
									<Mail size={14} />
								</button>
								{#if user.id !== auth.user?.id}
									<button
										class="icon-btn lock"
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
									<button class="icon-btn delete" onclick={() => deleteUser(user.id)} title="Delete user" aria-label="Delete user">
										<Trash2 size={14} />
									</button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</section>
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
	.page {
		max-width: 720px;
		margin: 0 auto;
		padding: 2rem 1rem;
	}

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
	h2 { font-size: 1.125rem; margin: 0 0 0.75rem; }

	.create-section,
	.users-section { margin-bottom: 2rem; }

	.create-form {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		align-items: center;
	}

	.create-form input[type='text'] {
		padding: 0.375rem 0.625rem;
		border: 1px solid var(--border-md);
		border-radius: 0.375rem;
		font-size: 0.875rem;
		background: var(--bg);
		color: var(--text);
	}

	.pw-field {
		display: inline-flex;
		min-width: 10rem;
		font-size: 0.875rem;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.875rem;
	}

	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border: none;
		border-radius: 0.375rem;
		cursor: pointer;
		background: transparent;
	}

	.create-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.875rem;
		border: 1px solid var(--accent);
		border-radius: 0.375rem;
		background: var(--accent);
		color: white;
		font-size: 0.875rem;
		cursor: pointer;
	}
	.create-btn:hover { background: var(--accent-dk); }

	.icon-btn.delete { color: var(--danger); }
	.icon-btn.delete:hover { background: var(--danger-bg); }

	.icon-btn.lock { color: var(--text-2); }
	.icon-btn.lock:hover { background: var(--bg-hover); color: var(--text); }

	.icon-btn.key { color: var(--accent); }
	.icon-btn.key:hover { background: var(--accent-lt); }

	.actions {
		display: flex;
		gap: 0.25rem;
		align-items: center;
	}

	.status {
		display: inline-block;
		padding: 0.125rem 0.5rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 500;
	}
	.locked-pill { background: var(--danger-bg); color: var(--danger); }
	.active-pill { background: var(--bg-hover); color: var(--text-2); }
	.pending-pill { background: var(--accent-lt); color: var(--accent); }

	.icon-btn.mail { color: var(--text-2); }
	.icon-btn.mail:hover { background: var(--bg-hover); color: var(--text); }

	.mode-toggle {
		display: flex;
		gap: 1rem;
		padding: 0.25rem 0;
		margin: 0 0 0.5rem;
		border: none;
		font-size: 0.875rem;
		color: var(--text-2);
	}
	.mode-toggle label {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		cursor: pointer;
	}

	.invite-result {
		margin-top: 1rem;
		padding: 0.75rem 0.875rem;
		border: 1px solid var(--accent);
		border-radius: 0.375rem;
		background: var(--accent-lt);
		font-size: 0.875rem;
	}
	.invite-result p { margin: 0 0 0.5rem; }

	.invite-url {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.5rem;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 0.25rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		overflow: auto;
	}
	.invite-url code {
		flex: 1;
		word-break: break-all;
		font-size: 0.8125rem;
	}

	.copy-btn, .dismiss-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.5rem;
		border: 1px solid var(--border-md);
		border-radius: 0.25rem;
		background: var(--bg);
		color: var(--text-2);
		font-size: 0.75rem;
		cursor: pointer;
		white-space: nowrap;
	}
	.copy-btn:hover, .dismiss-btn:hover { background: var(--bg-hover); color: var(--text); }
	.dismiss-btn { margin-top: 0.5rem; }
	.locked-row td { opacity: 0.8; }

	.error {
		color: var(--danger);
		font-size: 0.875rem;
		padding: 0.375rem 0.625rem;
		background: var(--danger-bg);
		border-radius: 0.375rem;
		margin-bottom: 0.5rem;
	}

	.users-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}

	.users-table th,
	.users-table td {
		text-align: left;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--border);
	}

	.users-table th { font-weight: 600; color: var(--text-3); }

	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.8125rem;
		color: var(--text-2);
		cursor: pointer;
	}

	.hint { font-size: 0.8125rem; color: var(--text-3); }
</style>
