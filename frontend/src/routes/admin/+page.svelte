<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { auth } from '$lib/stores/auth.svelte';
	import type { User } from '$lib/api';

	interface AdminUser {
		id: number;
		username: string;
		is_admin: boolean;
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
</script>

<svelte:head>
	<title>User Management — CrapNote</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<a href="/" class="back-link">← Notes</a>
		<h1>User management</h1>
	</header>

	<section class="create-section">
		<h2>Create user</h2>
		{#if createError}
			<p role="alert" class="error">{createError}</p>
		{/if}
		<form onsubmit={createUser} class="create-form">
			<input
				type="text"
				placeholder="Username"
				bind:value={newUsername}
				required
			/>
			<input
				type="password"
				placeholder="Password"
				bind:value={newPassword}
				required
			/>
			<label class="checkbox-label">
				<input type="checkbox" bind:checked={newIsAdmin} />
				Admin
			</label>
			<button type="submit">Create</button>
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
						<th>Created</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each users as user (user.id)}
						<tr>
							<td>{user.username}</td>
							<td>{user.is_admin ? 'Admin' : 'User'}</td>
							<td>{new Date(user.created_at).toLocaleDateString()}</td>
							<td>
								{#if user.id !== auth.user?.id}
									<button class="delete-btn" onclick={() => deleteUser(user.id)}>Delete</button>
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
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	h1 {
		font-size: 1.5rem;
		margin: 0;
	}

	h2 {
		font-size: 1.125rem;
		margin: 0 0 0.75rem;
	}

	.back-link {
		color: #6366f1;
		text-decoration: none;
		font-size: 0.875rem;
	}

	.create-section,
	.users-section {
		margin-bottom: 2rem;
	}

	.create-form {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		align-items: center;
	}

	.create-form input[type='text'],
	.create-form input[type='password'] {
		padding: 0.375rem 0.625rem;
		border: 1px solid #d1d5db;
		border-radius: 0.375rem;
		font-size: 0.875rem;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.875rem;
	}

	.create-form button {
		padding: 0.375rem 0.875rem;
		background: #6366f1;
		color: white;
		border: none;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
	}

	.error {
		color: #dc2626;
		font-size: 0.875rem;
		padding: 0.375rem 0.625rem;
		background: #fef2f2;
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
		border-bottom: 1px solid #e5e7eb;
	}

	.users-table th {
		font-weight: 600;
		color: #6b7280;
	}

	.delete-btn {
		padding: 0.25rem 0.5rem;
		background: #fee2e2;
		color: #dc2626;
		border: 1px solid #fecaca;
		border-radius: 0.25rem;
		cursor: pointer;
		font-size: 0.75rem;
	}
</style>
