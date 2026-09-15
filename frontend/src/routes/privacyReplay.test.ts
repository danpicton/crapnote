import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import Home from './+page.svelte';
import Detail from './notes/[id]/+page.svelte';
import type { Note } from '$lib/api';
import { clearAllNotes, getNote, openOfflineDB, setOfflineOwner, upsertNote, type CachedNote } from '$lib/offlineDB';
import { syncOfflineChanges } from '$lib/offlineSync';

// Render the real routes and run the real API client, ownership gate, cache,
// actions and replay. Only the network, session and rich-text editor are stubs.
vi.mock('$app/navigation', () => ({ goto: vi.fn(), beforeNavigate: vi.fn(), onNavigate: vi.fn() }));
vi.mock('$app/stores', async () => {
	const { readable } = await import('svelte/store');
	return { page: readable({ params: { id: '7' }, url: new URL('http://localhost/notes/7') }) };
});
vi.mock('$lib/stores/auth.svelte', () => ({ auth: {
	user: { id: 1, username: 'alice' }, ready: async () => {}, canReadCache: true, locked: false,
} }));
const editor = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
vi.mock('$lib/components/Editor.svelte', () => ({
	default: (_anchor: unknown, props: Record<string, unknown>) => { editor.props = props; },
}));

const baseTime = '2024-01-01T00:00:00Z';
let server: Note;
let copies: Note[];
let updates: Array<Record<string, unknown>>;
let db: IDBDatabase;

function cached(overrides: Partial<CachedNote> = {}): CachedNote {
	return { id: 7, title: server.title, body: server.body, starred: false, pinned: false,
		private: true, tags: [], server_updated_at: baseTime, local_updated_at: baseTime,
		is_dirty: false, is_new: false, ...overrides };
}

beforeEach(async () => {
	server = { id: 7, title: 'Sensitive title', body: 'Sensitive body', private: true,
		starred: false, pinned: false, archived: false, locked: false,
		created_at: baseTime, updated_at: baseTime };
	copies = [];
	updates = [];
	let revision = 0;
	db = await openOfflineDB();
	await clearAllNotes(db);
	await setOfflineOwner(db, 1);
	vi.stubGlobal('matchMedia', vi.fn((media: string) => ({ media, matches: false,
		addEventListener() {}, removeEventListener() {} })));
	vi.stubGlobal('navigator', { ...navigator, onLine: true });
	vi.stubGlobal('fetch', vi.fn(async (path: string, options: RequestInit = {}) => {
		const method = options.method ?? 'GET';
		const url = new URL(path, 'http://localhost');
		const data = options.body ? JSON.parse(options.body as string) : {};
		const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
		if (url.pathname.endsWith('/tags')) return json([]);
		if (url.pathname === '/api/notes' && method === 'GET') return json([server]);
		if (url.pathname === '/api/notes' && method === 'POST') {
			const copy = { ...server, id: 8 + copies.length, ...data, private: data.private ?? false };
			copies.push(copy);
			return json(copy);
		}
		if (url.pathname === '/api/notes/7' && method === 'GET') return json(server);
		if (url.pathname === '/api/notes/7' && method === 'PUT') {
			updates.push(data);
			server = { ...server, ...data, updated_at: `2024-01-01T00:00:${String(++revision).padStart(2, '0')}Z` };
			return json(server);
		}
		if (url.pathname === '/api/notes/7/star') { server = { ...server, starred: !server.starred }; return json(server); }
		throw new Error(`Unexpected request: ${method} ${path}`);
	}));
});
afterEach(() => { cleanup(); db.close(); vi.unstubAllGlobals(); });

describe('route privacy through the offline cache', () => {
	it.each([false, true])('does not publish a duplicate when cached public flags overlay a private server note (dirty content=%s)', async (dirty) => {
		await upsertNote(db, cached({ private: false, starred: true, flags_dirty: true,
			flags_toggled: { starred: true }, is_dirty: dirty }));
		render(Home);
		await screen.findByDisplayValue('Sensitive title');
		await fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
		await fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate note' }));
		await waitFor(() => expect(copies).toHaveLength(1));
		expect(copies[0]).toMatchObject({ title: 'Sensitive title (copy)', body: 'Sensitive body', private: true });
	});

	for (const [name, Route] of [['desktop', Home], ['detail', Detail]] as const) {
		it.each(['title', 'body'] as const)(`${name}: learns server privacy from a successful %s save before subsequent actions`, async (field) => {
			server.private = false;
			await upsertNote(db, cached({ private: false }));
			render(Route);
			const title = await screen.findByDisplayValue('Sensitive title');
			await screen.findByRole('button', { name: 'Make note private' });
			// Another device changes privacy, without refreshing this editor.
			server.private = true;
			if (field === 'title') {
				await fireEvent.focus(title);
				await fireEvent.input(title, { target: { value: 'Edited sensitive title' } });
				await fireEvent.blur(title);
			} else {
				(editor.props!.onchange as (body: string) => void)('Edited sensitive body');
			}
			await waitFor(() => expect(updates).toHaveLength(1), { timeout: 2000 });
			await waitFor(() => expect(screen.queryByText('Saving…')).not.toBeInTheDocument());
			if (name === 'desktop') {
				await fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
				await fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate note' }));
				await waitFor(() => expect(copies).toHaveLength(1));
				expect(copies[0]).toMatchObject({ private: true, body: server.body });
			}
			expect(await getNote(db, 7)).toMatchObject({ private: true });
			expect(screen.getByRole('button', { name: 'Make note visible to MCP' })).toHaveAttribute('aria-pressed', 'true');
		});

		it(`${name}: a delayed content response cannot undo a later explicit privacy clear`, async () => {
			await upsertNote(db, cached());
			render(Route);
			await screen.findByDisplayValue('Sensitive title');
			const request = vi.mocked(fetch).getMockImplementation()!;
			let release!: () => void;
			const held = new Promise<void>((resolve) => { release = resolve; });
			vi.mocked(fetch).mockImplementation(async (...args) => {
				const response = await request(...args);
				if (args[1]?.method === 'PUT' && JSON.parse(args[1].body as string).body) await held;
				return response;
			});
			(editor.props!.onchange as (body: string) => void)('Saved while private');
			await waitFor(() => expect(updates).toHaveLength(1), { timeout: 2000 });
			await fireEvent.click(screen.getByRole('button', { name: 'Make note visible to MCP' }));
			await waitFor(async () => expect(await getNote(db, 7)).toMatchObject({ private: false }));
			await screen.findByRole('button', { name: 'Make note private' });
			release();
			await waitFor(() => expect(screen.queryByText('Saving…')).not.toBeInTheDocument());
			expect(server.private).toBe(false);
			expect(await getNote(db, 7)).toMatchObject({ private: false, body: 'Saved while private' });
			expect(screen.getByRole('button', { name: 'Make note private' })).toHaveAttribute('aria-pressed', 'false');
		});

		it(`${name}: clearing privacy acknowledges only privacy, not unsynced content or queued actions`, async () => {
			await upsertNote(db, cached({ title: 'Unsynced title', body: 'Unsynced body', is_dirty: true,
				starred: true, flags_dirty: true, flags_toggled: { starred: true }, local_updated_at: '2024-01-02T00:00:00Z' }));
			render(Route);
			await screen.findByDisplayValue('Unsynced title');
			await fireEvent.click(screen.getByRole('button', { name: 'Make note visible to MCP' }));
			await waitFor(async () => expect(await getNote(db, 7)).toMatchObject({ private: false,
				title: 'Unsynced title', body: 'Unsynced body', is_dirty: true,
				flags_dirty: true, flags_toggled: { starred: true }, server_updated_at: baseTime,
				local_updated_at: '2024-01-02T00:00:00Z' }));
			expect(editor.props!.value).toBe('Unsynced body');
		});

		it.each([false, true])(`${name}: acknowledged privacy=%s survives an offline body edit and replay`, async (desired) => {
			server.private = !desired;
			// Queued star work prevents background cache refresh from masking the
			// missing privacy acknowledgement on the desktop route.
			await upsertNote(db, cached({ private: !desired, starred: true, flags_dirty: true, flags_toggled: { starred: true } }));
			render(Route);
			await screen.findByDisplayValue('Sensitive title');
			await fireEvent.click(screen.getByRole('button', { name: desired ? 'Make note private' : 'Make note visible to MCP' }));
			await waitFor(() => expect(server.private).toBe(desired));
			await waitFor(async () => expect(await getNote(db, 7)).toMatchObject({ private: desired, flags_dirty: true, starred: true }));
			vi.stubGlobal('navigator', { ...navigator, onLine: false });
			(editor.props!.onchange as (body: string) => void)('Offline body edit');
			await waitFor(async () => expect(await getNote(db, 7)).toMatchObject({ body: 'Offline body edit', is_dirty: true }), { timeout: 2000 });
			vi.stubGlobal('navigator', { ...navigator, onLine: true });
			expect((await syncOfflineChanges('manual', 1)).errors).toBe(0);
			expect(server).toMatchObject({ body: 'Offline body edit', private: desired });
			expect(copies).toHaveLength(0);
			expect(updates.at(-1)).not.toHaveProperty('private', !desired);
		});
	}
});
