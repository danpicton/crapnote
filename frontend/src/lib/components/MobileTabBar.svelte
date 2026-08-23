<script lang="ts">
	import { goto } from '$app/navigation';
	import { auth } from '$lib/stores/auth.svelte';
	import { BookOpen, Archive, Trash2, Settings, LogOut } from 'lucide-svelte';

	let { activeTab }: { activeTab: 'notes' | 'archive' | 'trash' | 'settings' } = $props();

	let showSignOutConfirm = $state(false);

	async function handleSignOut() {
		showSignOutConfirm = false;
		await auth.logout();
		goto('/login', { replaceState: true });
	}
</script>

<nav class="mob-tab-bar" aria-label="Main navigation">
	<a href="/" class="tab" class:tab-active={activeTab === 'notes'} aria-current={activeTab === 'notes' ? 'page' : undefined}>
		<BookOpen size={22} aria-hidden="true" />
		<span class="tab-label">Notes</span>
	</a>
	<a href="/archive" class="tab" class:tab-active={activeTab === 'archive'} aria-current={activeTab === 'archive' ? 'page' : undefined}>
		<Archive size={22} aria-hidden="true" />
		<span class="tab-label">Archive</span>
	</a>
	<a href="/trash" class="tab" class:tab-active={activeTab === 'trash'} aria-current={activeTab === 'trash' ? 'page' : undefined}>
		<Trash2 size={22} aria-hidden="true" />
		<span class="tab-label">Trash</span>
	</a>
	<a href="/settings" class="tab" class:tab-active={activeTab === 'settings'} aria-current={activeTab === 'settings' ? 'page' : undefined}>
		<Settings size={22} aria-hidden="true" />
		<span class="tab-label">Settings</span>
	</a>
	<button class="tab tab-signout" onclick={() => (showSignOutConfirm = true)} aria-label="Sign out">
		<LogOut size={22} aria-hidden="true" />
		<span class="tab-label">Sign out</span>
	</button>
</nav>

{#if showSignOutConfirm}
	<div class="signout-backdrop" onclick={() => (showSignOutConfirm = false)} role="presentation"></div>
	<div class="signout-sheet" role="alertdialog" aria-label="Sign out confirmation">
		<div class="sheet-handle" aria-hidden="true"></div>
		<p class="signout-title">Sign out of {auth.user?.username}?</p>
		<button class="signout-confirm" onclick={handleSignOut}>Sign out</button>
		<button class="signout-cancel" onclick={() => (showSignOutConfirm = false)}>Cancel</button>
	</div>
{/if}

<style>
	.mob-tab-bar {
		display: flex;
		border-top: 1px solid var(--border);
		background: var(--bg-alt);
		padding: 6px 0 calc(10px + env(safe-area-inset-bottom, 0px));
		flex-shrink: 0;
	}

	@media (min-width: 641px) {
		.mob-tab-bar { display: none !important; }
	}

	.tab {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 3px;
		padding: 4px 0;
		color: var(--text-3);
		background: none;
		border: none;
		cursor: pointer;
		text-decoration: none;
		min-height: 44px;
	}

	.tab-label {
		font-family: var(--sans);
		font-size: 11px;
		letter-spacing: 0.2px;
		line-height: 1;
	}

	.tab:hover { color: var(--text-2); }
	.tab-active { color: var(--accent) !important; }

	/* Sign-out sheet */
	.signout-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.32);
		z-index: 100;
	}

	.signout-sheet {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		background: var(--bg-alt);
		border-radius: 18px 18px 0 0;
		padding: 12px 20px calc(16px + env(safe-area-inset-bottom, 0px));
		z-index: 101;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.sheet-handle {
		width: 40px;
		height: 4px;
		background: var(--border);
		border-radius: 2px;
		margin: 0 auto 8px;
		flex-shrink: 0;
	}

	.signout-title {
		font-family: var(--serif);
		font-size: 18px;
		font-weight: 700;
		color: var(--text);
		margin: 0 0 4px;
		text-align: center;
	}

	.signout-confirm {
		padding: 13px 16px;
		background: var(--danger);
		color: white;
		border: none;
		border-radius: 10px;
		font-size: 16px;
		font-weight: 600;
		font-family: var(--sans);
		cursor: pointer;
		width: 100%;
	}

	.signout-cancel {
		padding: 13px 16px;
		background: var(--bg-hover);
		color: var(--text-2);
		border: none;
		border-radius: 10px;
		font-size: 16px;
		font-family: var(--sans);
		cursor: pointer;
		width: 100%;
	}
</style>
