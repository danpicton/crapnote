<script lang="ts">
	import { ChevronLeft, Moon, Sun, Users } from 'lucide-svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { theme } from '$lib/stores/theme.svelte';

	let exportPassword = $state('');

	function doExport() {
		const url = exportPassword
			? `/api/export?password=${encodeURIComponent(exportPassword)}`
			: '/api/export';
		const a = document.createElement('a');
		a.href = url;
		a.download = '';
		a.click();
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
