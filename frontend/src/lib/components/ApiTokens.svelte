<script lang="ts">
	import { onMount } from 'svelte';
	import { Trash2, Copy, Check } from 'lucide-svelte';
	import { api, ApiError, type ApiToken, type CreatedApiToken } from '$lib/api';

	interface Props {
		/** Whether the caller may create tokens. If false we still show the
		 * list (so the user can see/revoke existing ones), but the create form
		 * is hidden with an explanatory note. */
		canCreate: boolean;
	}

	let { canCreate }: Props = $props();

	let tokens = $state<ApiToken[]>([]);
	let loading = $state(true);
	let loadError = $state('');

	let newName = $state('');
	let newScope = $state<'read' | 'read_write'>('read_write');
	let newTtlDays = $state(90);
	let createError = $state('');
	let creating = $state(false);
	let justCreated = $state<CreatedApiToken | null>(null);
	let copied = $state(false);

	onMount(loadTokens);

	async function loadTokens() {
		loading = true;
		loadError = '';
		try {
			tokens = (await api.tokens.list()) ?? [];
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load tokens.';
		} finally {
			loading = false;
		}
	}

	async function createToken(e: Event) {
		e.preventDefault();
		createError = '';
		creating = true;
		try {
			const created = await api.tokens.create(newName.trim(), newScope, newTtlDays);
			justCreated = created;
			newName = '';
			// Reload list so the new (hashed) record appears immediately.
			await loadTokens();
		} catch (err) {
			if (err instanceof ApiError) createError = prettyError(err);
			else createError = err instanceof Error ? err.message : 'Failed to create token.';
		} finally {
			creating = false;
		}
	}

	function prettyError(err: ApiError): string {
		try {
			const parsed = JSON.parse(err.message) as { error?: string };
			return parsed.error ?? err.message;
		} catch {
			return err.message;
		}
	}

	async function copyToken() {
		if (!justCreated) return;
		try {
			await navigator.clipboard.writeText(justCreated.token);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// Fallback: select the textarea so the user can copy manually.
		}
	}

	function dismissCreated() {
		justCreated = null;
		copied = false;
	}

	async function revokeToken(id: number) {
		if (!confirm('Revoke this token? External clients using it will stop working immediately.')) return;
		try {
			await api.tokens.revoke(id);
			await loadTokens();
		} catch (err) {
			alert(err instanceof Error ? err.message : 'Failed to revoke token.');
		}
	}

	async function revokeAll() {
		if (tokens.length === 0) return;
		if (!confirm(`Revoke all ${tokens.length} token(s)? This does not sign you out on other devices.`)) return;
		try {
			await api.tokens.revokeAll();
			await loadTokens();
		} catch (err) {
			alert(err instanceof Error ? err.message : 'Failed to revoke tokens.');
		}
	}

	function fmtDate(iso?: string) {
		if (!iso) return '—';
		return new Date(iso).toLocaleString();
	}

	function status(t: ApiToken): string {
		if (t.revoked_at) return 'Revoked';
		if (t.expires_at && new Date(t.expires_at) < new Date()) return 'Expired';
		return 'Active';
	}
</script>

<div class="tokens">
	{#if justCreated}
		<div class="new-token" role="alert">
			<strong>Your new token (shown once — copy it now):</strong>
			<div class="token-row">
				<code class="token-value">{justCreated.token}</code>
				<button type="button" class="copy-btn" onclick={copyToken} aria-label="Copy token">
					{#if copied}
						<Check size={14} /> Copied
					{:else}
						<Copy size={14} /> Copy
					{/if}
				</button>
			</div>
			<p class="hint">Store this somewhere safe. You won't be able to see it again.</p>
			<button type="button" class="secondary" onclick={dismissCreated}>Dismiss</button>
		</div>
	{/if}

	<div class="create-card">
		<p class="card-hint">
			Authenticate with <code>Authorization: Bearer cnp_…</code> — each token is shown once on creation.
		</p>
		{#if canCreate}
			<form class="create-form" onsubmit={createToken}>
				{#if createError}
					<p role="alert" class="error">{createError}</p>
				{/if}
				<div class="fields-row">
					<div class="field-group field-name">
						<span class="field-label">Name</span>
						<input
							type="text"
							placeholder="e.g. cli-laptop"
							bind:value={newName}
							maxlength={80}
							required
						/>
					</div>
					<div class="field-group">
						<span class="field-label">Scope</span>
						<div class="seg-ctrl" role="group" aria-label="Token scope">
							<button type="button" class="seg-btn" class:seg-active={newScope === 'read'} onclick={() => (newScope = 'read')}>Read only</button>
							<button type="button" class="seg-btn" class:seg-active={newScope === 'read_write'} onclick={() => (newScope = 'read_write')}>Read + write</button>
						</div>
					</div>
					<div class="field-group field-expires">
						<span class="field-label">Expires (days)</span>
						<input class="expires-input" type="number" min="-1" max="3650" bind:value={newTtlDays} />
					</div>
					<div class="field-group field-submit">
						<span class="field-label">&nbsp;</span>
						<button type="submit" class="primary" disabled={creating}>
							{creating ? 'Creating…' : '+ Create token'}
						</button>
					</div>
				</div>
				<p class="sub-hint">Use -1 for no expiry.</p>
			</form>
		{:else}
			<p class="hint">API token creation is disabled for your account. Ask an administrator to enable it.</p>
		{/if}
	</div>

	{#if loading}
		<p>Loading tokens…</p>
	{:else if loadError}
		<p role="alert" class="error">{loadError}</p>
	{:else if tokens.length === 0}
		<p class="hint">No API tokens yet.</p>
	{:else}
		<div class="list-header">
			<button type="button" class="secondary danger" onclick={revokeAll}>Revoke all</button>
		</div>
		<table class="tokens-table">
			<thead>
				<tr>
					<th>Name</th>
					<th>Prefix</th>
					<th>Scope</th>
					<th>Status</th>
					<th>Last used</th>
					<th>Expires</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each tokens as t (t.id)}
					<tr class:revoked={!!t.revoked_at}>
						<td>{t.name}</td>
						<td><code>{t.prefix}…</code></td>
						<td>{t.scope === 'read_write' ? 'Read+Write' : 'Read'}</td>
						<td>{status(t)}</td>
						<td>{fmtDate(t.last_used_at)}</td>
						<td>{fmtDate(t.expires_at)}</td>
						<td>
							{#if !t.revoked_at}
								<button class="icon-btn" onclick={() => revokeToken(t.id)} aria-label="Revoke token" title="Revoke token">
									<Trash2 size={14} />
								</button>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>

<style>
	.tokens { display: flex; flex-direction: column; gap: 0.75rem; }
	.hint { font-size: 0.8125rem; color: var(--text-3); margin: 0; }

	.new-token {
		padding: 0.75rem;
		border: 1px solid var(--accent);
		background: var(--accent-lt);
		border-radius: 0.375rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.token-row { display: flex; gap: 0.5rem; align-items: center; }
	.token-value {
		flex: 1;
		padding: 0.375rem 0.5rem;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 0.25rem;
		font-family: monospace;
		font-size: 0.8125rem;
		overflow-x: auto;
		white-space: nowrap;
	}
	.copy-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.375rem 0.625rem;
		border: 1px solid var(--border-md);
		border-radius: 0.25rem;
		background: var(--bg);
		cursor: pointer;
		font-size: 0.8125rem;
	}

	.create-card {
		background: var(--bg-alt);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 1rem 1.25rem 1.125rem;
	}
	.card-hint {
		font-size: 0.8125rem;
		color: var(--text-3);
		line-height: 1.5;
		margin: 0 0 1rem;
	}
	.card-hint code {
		font-family: var(--mono);
		font-size: 0.75rem;
		background: var(--bg-hover);
		padding: 1px 5px;
		color: var(--text-2);
	}

	.create-form { display: flex; flex-direction: column; gap: 0; }

	.fields-row {
		display: flex;
		gap: 0.75rem;
		align-items: flex-end;
		flex-wrap: wrap;
	}
	.field-group {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	.field-name { flex: 1; min-width: 160px; }
	.field-expires { width: 90px; }
	.field-label {
		font-size: 0.6375rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--text-3);
		font-family: var(--sans);
	}
	.create-form input[type='text'],
	.create-form input[type='number'] {
		padding: 0.4rem 0.625rem;
		border: 1px solid var(--border-md);
		font-size: 0.875rem;
		background: var(--bg);
		color: var(--text);
		font-family: var(--sans);
		width: 100%;
		box-sizing: border-box;
	}
	.expires-input { text-align: center; }
	.sub-hint { font-size: 0.75rem; color: var(--text-4); margin: 0.5rem 0 0; }

	/* Segmented scope control */
	.seg-ctrl {
		display: inline-flex;
		border: 1px solid var(--border-md);
	}
	.seg-btn {
		font-family: var(--sans);
		font-size: 0.8125rem;
		padding: 0.4rem 0.75rem;
		background: var(--bg);
		color: var(--text-2);
		border: none;
		border-left: 1px solid var(--border-md);
		cursor: pointer;
		white-space: nowrap;
	}
	.seg-btn:first-child { border-left: none; }
	.seg-btn:hover:not(.seg-active) { background: var(--bg-hover); }
	.seg-active { background: var(--text); color: var(--bg); }

	.primary {
		padding: 0.375rem 0.875rem;
		background: var(--accent);
		color: white;
		border: none;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.875rem;
	}
	.primary:disabled { opacity: 0.6; cursor: not-allowed; }
	.primary:hover:not(:disabled) { background: var(--accent-dk); }

	.secondary {
		padding: 0.375rem 0.625rem;
		background: transparent;
		border: 1px solid var(--border-md);
		border-radius: 0.375rem;
		cursor: pointer;
		color: var(--text-2);
		font-size: 0.875rem;
	}
	.secondary.danger { color: var(--danger); border-color: var(--danger); }
	.secondary:hover { background: var(--bg-hover); }

	.list-header { display: flex; justify-content: flex-end; }

	.tokens-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}
	.tokens-table th,
	.tokens-table td {
		text-align: left;
		padding: 0.375rem 0.5rem;
		border-bottom: 1px solid var(--border);
	}
	.tokens-table th { font-weight: 600; color: var(--text-3); }
	.tokens-table tr.revoked { opacity: 0.6; }

	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border: none;
		border-radius: 0.25rem;
		cursor: pointer;
		background: transparent;
		color: var(--danger);
	}
	.icon-btn:hover { background: var(--danger-bg); }

	.error {
		color: var(--danger);
		font-size: 0.875rem;
		padding: 0.375rem 0.625rem;
		background: var(--danger-bg);
		border-radius: 0.375rem;
		margin: 0;
	}
</style>
