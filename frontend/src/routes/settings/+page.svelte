<script lang="ts">
	import { auth } from '$lib/stores/auth.svelte';

	let exportPassword = $state('');
</script>

<svelte:head>
	<title>Settings — CrapNote</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<a href="/" class="back-link">← Notes</a>
		<h1>Settings</h1>
	</header>

	<section class="section">
		<h2>Export</h2>
		<p class="hint">Download all your notes as a ZIP of Markdown files. Optionally protect with a password (AES-256).</p>
		<div class="export-row">
			<input
				type="password"
				placeholder="Password (optional)"
				bind:value={exportPassword}
				autocomplete="new-password"
			/>
			<a
				href={exportPassword ? `/api/export?password=${encodeURIComponent(exportPassword)}` : '/api/export'}
				class="export-btn"
				download
			>
				Export notes
			</a>
		</div>
	</section>

	{#if auth.user?.is_admin}
		<section class="section">
			<h2>Administration</h2>
			<a href="/admin" class="link-btn">User management →</a>
		</section>
	{/if}

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
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	h1 { flex: 1; font-size: 1.5rem; margin: 0; }
	h2 { font-size: 1rem; margin: 0 0 0.5rem; color: #374151; }

	.back-link { color: #6366f1; text-decoration: none; font-size: 0.875rem; }

	.section {
		margin-bottom: 2rem;
		padding-bottom: 1.5rem;
		border-bottom: 1px solid #e5e7eb;
	}

	.section:last-child { border-bottom: none; }

	.hint { font-size: 0.875rem; color: #6b7280; margin: 0 0 0.75rem; }

	.export-row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
	}

	.export-row input {
		padding: 0.375rem 0.625rem;
		border: 1px solid #d1d5db;
		border-radius: 0.375rem;
		font-size: 0.875rem;
		flex: 1;
		min-width: 150px;
	}

	.export-btn {
		padding: 0.375rem 0.875rem;
		background: #6366f1;
		color: white;
		border: none;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
		text-decoration: none;
		white-space: nowrap;
	}

	.export-btn:hover { background: #4f46e5; }

	.link-btn {
		display: inline-block;
		color: #6366f1;
		font-size: 0.875rem;
		text-decoration: none;
	}

	.link-btn:hover { text-decoration: underline; }
</style>
