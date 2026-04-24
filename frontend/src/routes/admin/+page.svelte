<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronLeft, UserPlus, Trash2, Lock, LockOpen, Key } from 'lucide-svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import PasswordInput from '$lib/components/PasswordInput.svelte';
	import PasswordPromptModal from '$lib/components/PasswordPromptModal.svelte';

	interface AdminUser {
		id: number;
		username: string;
		is_admin: boolean;
		api_tokens_enabled: boolean;
		locked: boolean;
		locked_at?: string;
		created_at: string;
	}

	let users = $state<AdminUser[]>([]);
	let loading = $state(true);
	let newUsername = $state('');
	let newPassword = $state('');
	let newIsAdmin = $state(false);
	let createError = $state('');

	let passwordModalUser = $state<AdminUser | null>(null);
	let passwordModalSubmitting = $state(false);
	let passwordModalError = $state('');

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
		const res = await fetch('/api/admin/users', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({ username: newUsername, password: newPassword, is_admin: newIsAdmin }),
		});
		if (res.ok) {
			newUsername = '';
			newPassword = '';
			newIsAdmin = false;
			await loadUsers();
		} else {
			const text = await res.text();
			createError = text || 'Failed to create user.';
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
		<form onsubmit={createUser} class="create-form">
			<input type="text" placeholder="Username" bind:value={newUsername} required />
			<div class="pw-field">
				<PasswordInput
					id="new-user-password"
					placeholder="Password"
					autocomplete="new-password"
					bind:value={newPassword}
					required
				/>
			</div>
			<label class="checkbox-label">
				<input type="checkbox" bind:checked={newIsAdmin} />
				Admin
			</label>
			<button type="submit" class="icon-btn create" title="Create user" aria-label="Create user">
				<UserPlus size={16} />
			</button>
		</form>
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

	.icon-btn.create { color: var(--accent); }
	.icon-btn.create:hover { background: var(--accent-lt); }

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
