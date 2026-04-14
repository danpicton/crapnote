import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

// Mock api and offlineDB so sync logic is tested in isolation
vi.mock('$lib/api', () => ({
	api: {
		notes: {
			create: vi.fn(),
			get: vi.fn(),
			update: vi.fn(),
		},
	},
}));

vi.mock('$lib/offlineDB', () => ({
	openOfflineDB: vi.fn(),
	getDirtyNotes: vi.fn(),
	upsertNote: vi.fn(),
	deleteNote: vi.fn(),
	getNote: vi.fn(),
	getAllNotes: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import { api } from '$lib/api';
import * as offlineDB from '$lib/offlineDB';
import type { CachedNote } from '$lib/offlineDB';
import { syncOfflineChanges } from './offlineSync';

const fakeCachedNote = (overrides: Partial<CachedNote> = {}): CachedNote => ({
	id: 1,
	title: 'Note',
	body: 'Body',
	starred: false,
	pinned: false,
	tags: [],
	server_updated_at: '2024-01-01T00:00:00Z',
	local_updated_at: '2024-01-02T00:00:00Z',
	is_dirty: true,
	is_new: false,
	...overrides,
});

const fakeServerNote = (overrides = {}) => ({
	id: 1,
	title: 'Server Note',
	body: 'Server Body',
	starred: false,
	pinned: false,
	archived: false,
	created_at: '2024-01-01T00:00:00Z',
	updated_at: '2024-01-01T00:00:00Z',
	...overrides,
});

const fakeDB = { close: vi.fn() } as unknown as IDBDatabase;

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(offlineDB.openOfflineDB).mockResolvedValue(fakeDB);
	vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([]);
	vi.mocked(offlineDB.upsertNote).mockResolvedValue(undefined);
	vi.mocked(offlineDB.deleteNote).mockResolvedValue(undefined);
});

describe('syncOfflineChanges — new notes', () => {
	it('POSTs a new offline note to the server', async () => {
		const note = fakeCachedNote({ id: -1000, is_new: true, title: 'New', body: 'Hello' });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.create).mockResolvedValue(fakeServerNote({ id: 99, title: 'New', body: 'Hello', updated_at: '2024-01-03T00:00:00Z' }));

		await syncOfflineChanges();

		expect(api.notes.create).toHaveBeenCalledWith('New', 'Hello');
	});

	it('removes the temp note from cache and inserts with server id', async () => {
		const note = fakeCachedNote({ id: -1000, is_new: true });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.create).mockResolvedValue(fakeServerNote({ id: 99, updated_at: '2024-01-03T00:00:00Z' }));

		await syncOfflineChanges();

		expect(offlineDB.deleteNote).toHaveBeenCalledWith(fakeDB, -1000);
		expect(offlineDB.upsertNote).toHaveBeenCalledWith(fakeDB, expect.objectContaining({
			id: 99,
			is_dirty: false,
			is_new: false,
			server_updated_at: '2024-01-03T00:00:00Z',
		}));
	});
});

describe('syncOfflineChanges — modified notes, no conflict', () => {
	it('GETs the server note to check for conflict', async () => {
		const note = fakeCachedNote({ id: 5, server_updated_at: '2024-01-01T00:00:00Z' });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.get).mockResolvedValue(fakeServerNote({ id: 5, updated_at: '2024-01-01T00:00:00Z' }));
		vi.mocked(api.notes.update).mockResolvedValue(fakeServerNote({ id: 5, updated_at: '2024-01-05T00:00:00Z' }));

		await syncOfflineChanges();

		expect(api.notes.get).toHaveBeenCalledWith(5);
	});

	it('PUTs local changes when server timestamp matches', async () => {
		const note = fakeCachedNote({ id: 5, title: 'Local', body: 'Local body', server_updated_at: '2024-01-01T00:00:00Z' });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.get).mockResolvedValue(fakeServerNote({ id: 5, updated_at: '2024-01-01T00:00:00Z' }));
		vi.mocked(api.notes.update).mockResolvedValue(fakeServerNote({ id: 5, updated_at: '2024-01-05T00:00:00Z' }));

		await syncOfflineChanges();

		expect(api.notes.update).toHaveBeenCalledWith(5, { title: 'Local', body: 'Local body' });
	});

	it('marks cached note as clean after successful PUT', async () => {
		const note = fakeCachedNote({ id: 5, server_updated_at: '2024-01-01T00:00:00Z' });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.get).mockResolvedValue(fakeServerNote({ id: 5, updated_at: '2024-01-01T00:00:00Z' }));
		vi.mocked(api.notes.update).mockResolvedValue(fakeServerNote({ id: 5, updated_at: '2024-01-05T00:00:00Z' }));

		await syncOfflineChanges();

		expect(offlineDB.upsertNote).toHaveBeenCalledWith(fakeDB, expect.objectContaining({
			id: 5,
			is_dirty: false,
			server_updated_at: '2024-01-05T00:00:00Z',
		}));
	});
});

describe('syncOfflineChanges — conflict', () => {
	it('creates a conflict note with [sync conflict] prefix when server changed', async () => {
		const note = fakeCachedNote({ id: 7, title: 'My Edit', body: 'My body', server_updated_at: '2024-01-01T00:00:00Z' });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		// Server has a newer timestamp → conflict
		vi.mocked(api.notes.get).mockResolvedValue(fakeServerNote({ id: 7, updated_at: '2024-01-02T00:00:00Z' }));
		vi.mocked(api.notes.create).mockResolvedValue(fakeServerNote({ id: 999 }));

		await syncOfflineChanges();

		expect(api.notes.create).toHaveBeenCalledWith('[sync conflict] My Edit', 'My body');
	});

	it('does NOT call update when there is a conflict', async () => {
		const note = fakeCachedNote({ id: 7, server_updated_at: '2024-01-01T00:00:00Z' });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.get).mockResolvedValue(fakeServerNote({ id: 7, updated_at: '2024-01-02T00:00:00Z' }));
		vi.mocked(api.notes.create).mockResolvedValue(fakeServerNote({ id: 999 }));

		await syncOfflineChanges();

		expect(api.notes.update).not.toHaveBeenCalled();
	});

	it('stores the server version in cache after a conflict', async () => {
		const note = fakeCachedNote({ id: 7, server_updated_at: '2024-01-01T00:00:00Z' });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		const serverNote = fakeServerNote({ id: 7, title: 'Server Title', body: 'Server Body', updated_at: '2024-01-02T00:00:00Z' });
		vi.mocked(api.notes.get).mockResolvedValue(serverNote);
		vi.mocked(api.notes.create).mockResolvedValue(fakeServerNote({ id: 999 }));

		await syncOfflineChanges();

		expect(offlineDB.upsertNote).toHaveBeenCalledWith(fakeDB, expect.objectContaining({
			id: 7,
			title: 'Server Title',
			body: 'Server Body',
			is_dirty: false,
			server_updated_at: '2024-01-02T00:00:00Z',
		}));
	});

	it('local wins when local_updated_at is newer than server updated_at — server version becomes the conflict note', async () => {
		// Both changed since last sync, but local is more recent.
		const note = fakeCachedNote({
			id: 7,
			title: 'Local Newer',
			body: 'Local body',
			server_updated_at: '2024-01-01T00:00:00Z',
			local_updated_at: '2024-01-05T00:00:00Z', // local is newer
		});
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.get).mockResolvedValue(fakeServerNote({
			id: 7, title: 'Server Older', body: 'Server body',
			updated_at: '2024-01-03T00:00:00Z', // server moved but less recently than local
		}));
		vi.mocked(api.notes.update).mockResolvedValue(fakeServerNote({ id: 7, updated_at: '2024-01-05T00:00:00Z' }));
		vi.mocked(api.notes.create).mockResolvedValue(fakeServerNote({ id: 999 }));

		await syncOfflineChanges();

		// Local wins: local edit is PUT to server
		expect(api.notes.update).toHaveBeenCalledWith(7, { title: 'Local Newer', body: 'Local body' });
		// Loser (server version) is preserved as a new conflict note
		expect(api.notes.create).toHaveBeenCalledWith('[sync conflict] Server Older', 'Server body');
	});

	it('server wins when server updated_at is newer than local — local version becomes the conflict note', async () => {
		const note = fakeCachedNote({
			id: 7,
			title: 'Local Older',
			body: 'Local body',
			server_updated_at: '2024-01-01T00:00:00Z',
			local_updated_at: '2024-01-02T00:00:00Z',
		});
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.get).mockResolvedValue(fakeServerNote({
			id: 7, title: 'Server Newer', body: 'Server body',
			updated_at: '2024-01-05T00:00:00Z', // server is more recent
		}));
		vi.mocked(api.notes.create).mockResolvedValue(fakeServerNote({ id: 999 }));

		await syncOfflineChanges();

		// Server wins: NO update call (server version stays as-is)
		expect(api.notes.update).not.toHaveBeenCalled();
		// Loser (local version) becomes a new conflict note
		expect(api.notes.create).toHaveBeenCalledWith('[sync conflict] Local Older', 'Local body');
	});
});

describe('syncOfflineChanges — result and logging', () => {
	it('returns a structured SyncResult with counts', async () => {
		const newNote = fakeCachedNote({ id: -1, is_new: true });
		const updatedNote = fakeCachedNote({ id: 5, is_dirty: true, is_new: false,
			server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-02T00:00:00Z' });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([newNote, updatedNote]);
		vi.mocked(api.notes.create).mockResolvedValue(fakeServerNote({ id: 99, updated_at: '2024-01-03T00:00:00Z' }));
		vi.mocked(api.notes.get).mockResolvedValue(fakeServerNote({ id: 5, updated_at: '2024-01-01T00:00:00Z' }));
		vi.mocked(api.notes.update).mockResolvedValue(fakeServerNote({ id: 5, updated_at: '2024-01-05T00:00:00Z' }));

		const result = await syncOfflineChanges();

		expect(result.pushed.created).toBe(1);
		expect(result.pushed.updated).toBe(1);
		expect(result.conflicts).toBe(0);
		expect(result.errors).toBe(0);
		expect(typeof result.durationMs).toBe('number');
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(typeof result.startedAt).toBe('string');
		expect(result.mappings).toEqual([{ tempId: -1, serverId: 99 }]);
	});

	it('counts conflicts in the result', async () => {
		const note = fakeCachedNote({ id: 7, server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-02T00:00:00Z' });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.get).mockResolvedValue(fakeServerNote({ id: 7, updated_at: '2024-01-05T00:00:00Z' }));
		vi.mocked(api.notes.create).mockResolvedValue(fakeServerNote({ id: 999 }));

		const result = await syncOfflineChanges();

		expect(result.conflicts).toBe(1);
	});

	it('counts errors when a note sync throws', async () => {
		const note = fakeCachedNote({ id: -1, is_new: true });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.create).mockRejectedValue(new Error('Network down'));

		const result = await syncOfflineChanges();

		expect(result.errors).toBe(1);
	});

	it('accepts a trigger parameter and echoes it in the result', async () => {
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([]);

		const result = await syncOfflineChanges('manual');

		expect(result.trigger).toBe('manual');
	});

	it('logs a summary line to console.info after each run', async () => {
		const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([]);

		await syncOfflineChanges('heartbeat');

		// Must be a single structured log call that includes "sync" and the trigger
		expect(spy).toHaveBeenCalled();
		const call = spy.mock.calls[0];
		expect(call.join(' ').toLowerCase()).toMatch(/sync/);
		// The trigger should be visible in the log payload
		const serialized = call.map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
		expect(serialized).toContain('heartbeat');
		spy.mockRestore();
	});
});

describe('syncOfflineChanges — resilience', () => {
	it('continues syncing remaining notes if one note sync throws', async () => {
		const note1 = fakeCachedNote({ id: 10, is_new: true });
		const note2 = fakeCachedNote({ id: 11, is_new: true });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note1, note2]);
		vi.mocked(api.notes.create)
			.mockRejectedValueOnce(new Error('Network error'))
			.mockResolvedValueOnce(fakeServerNote({ id: 99, updated_at: '2024-01-03T00:00:00Z' }));

		await syncOfflineChanges();

		// Should have attempted both
		expect(api.notes.create).toHaveBeenCalledTimes(2);
	});

	it('returns ID mappings for newly created notes', async () => {
		const note = fakeCachedNote({ id: -1000, is_new: true });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.create).mockResolvedValue(fakeServerNote({ id: 99, updated_at: '2024-01-03T00:00:00Z' }));

		const result = await syncOfflineChanges();

		expect(result.mappings).toEqual([{ tempId: -1000, serverId: 99 }]);
	});

	it('prevents concurrent sync runs — second call is skipped immediately', async () => {
		const note = fakeCachedNote({ id: 5 });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.get).mockResolvedValue(fakeServerNote({ id: 5, updated_at: '2024-01-01T00:00:00Z' }));
		vi.mocked(api.notes.update).mockResolvedValue(fakeServerNote({ id: 5, updated_at: '2024-01-05T00:00:00Z' }));

		const [, r2] = await Promise.all([syncOfflineChanges(), syncOfflineChanges()]);

		// Second call skipped entirely; note was only synced once
		expect(api.notes.get).toHaveBeenCalledTimes(1);
		expect(r2.skipped).toBe(true);
		expect(r2.mappings).toEqual([]);
	});
});
