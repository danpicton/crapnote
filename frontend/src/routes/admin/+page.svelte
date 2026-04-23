<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChevronLeft, UserPlus, Trash2 } from 'lucide-svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import PasswordInput from '$lib/components/PasswordInput.svelte';

	interface AdminUser {
		id: number;
		username: string;
		is_admin: boolean;
		api_tokens_enabled: boolean;
		created_at: string;
	}

	let users = $state<AdminUser[]>([]);
	let loading = $state(true);
	let newUsername = $state('');
	let newPassword = $state('');
	let newIsAdmin = $state(false);
	let createError = $state('');

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
						<th>API tokens</th>
						<th>Created</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each users as user (user.id)}
						<tr>
							<td>{user.username}</td>
							<td>{user.is_admin ? 'Admin' : 'User'}</td>
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
							<td>
								{#if user.id !== auth.user?.id}
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
