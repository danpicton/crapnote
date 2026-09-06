import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

// Mock api and offlineDB so sync logic is tested in isolation
vi.mock('$lib/api', () => {
	class ApiError extends Error {
		constructor(public readonly status: number, message: string) { super(message); this.name = 'ApiError'; }
	}
	class OfflineError extends ApiError {
		constructor(message = 'offline') { super(503, message); this.name = 'OfflineError'; }
	}
	return {
	ApiError,
	OfflineError,
	api: {
		notes: {
			create: vi.fn(),
			get: vi.fn(),
			update: vi.fn(),
			delete: vi.fn(),
			archive: vi.fn(),
			toggleStar: vi.fn(),
			togglePin: vi.fn(),
			toggleLock: vi.fn(),
		},
	},
};
});

// Only the IndexedDB entry points are stubbed. Pure helpers (noteFlags) stay
// real — mocking them would hide exactly the field-drop bugs they exist to
// prevent.
vi.mock('$lib/offlineDB', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/offlineDB')>()),
	openOfflineDB: vi.fn(),
	getDirtyNotes: vi.fn(),
	upsertNote: vi.fn(),
	deleteNote: vi.fn(),
	getNote: vi.fn(),
	getAllNotes: vi.fn(),
	getOfflineOwner: vi.fn(),
	setOfflineOwner: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import { api, ApiError } from '$lib/api';
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
	locked: false,
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
	vi.mocked(offlineDB.getOfflineOwner).mockResolvedValue(1);
	vi.mocked(offlineDB.setOfflineOwner).mockResolvedValue(undefined);
});

describe('syncOfflineChanges — new notes', () => {
	it('POSTs a new offline note to the server', async () => {
		const note = fakeCachedNote({ id: -1000, is_new: true, title: 'New', body: 'Hello' });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.create).mockResolvedValue(fakeServerNote({ id: 99, title: 'New', body: 'Hello', updated_at: '2024-01-03T00:00:00Z' }));

		await syncOfflineChanges('heartbeat', 1);

		expect(api.notes.create).toHaveBeenCalledWith('New', 'Hello');
	});

	it('removes the temp note from cache and inserts with server id', async () => {
		const note = fakeCachedNote({ id: -1000, is_new: true });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.create).mockResolvedValue(fakeServerNote({ id: 99, updated_at: '2024-01-03T00:00:00Z' }));

		await syncOfflineChanges('heartbeat', 1);

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

		await syncOfflineChanges('heartbeat', 1);

		expect(api.notes.get).toHaveBeenCalledWith(5);
	});

	it('PUTs local changes when server timestamp matches', async () => {
		const note = fakeCachedNote({ id: 5, title: 'Local', body: 'Local body', server_updated_at: '2024-01-01T00:00:00Z' });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.get).mockResolvedValue(fakeServerNote({ id: 5, updated_at: '2024-01-01T00:00:00Z' }));
		vi.mocked(api.notes.update).mockResolvedValue(fakeServerNote({ id: 5, updated_at: '2024-01-05T00:00:00Z' }));

		await syncOfflineChanges('heartbeat', 1);

		expect(api.notes.update).toHaveBeenCalledWith(5, { title: 'Local', body: 'Local body' });
	});

	it('marks cached note as clean after successful PUT', async () => {
		const note = fakeCachedNote({ id: 5, server_updated_at: '2024-01-01T00:00:00Z' });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.get).mockResolvedValue(fakeServerNote({ id: 5, updated_at: '2024-01-01T00:00:00Z' }));
		vi.mocked(api.notes.update).mockResolvedValue(fakeServerNote({ id: 5, updated_at: '2024-01-05T00:00:00Z' }));

		await syncOfflineChanges('heartbeat', 1);

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

		await syncOfflineChanges('heartbeat', 1);

		expect(api.notes.create).toHaveBeenCalledWith('[sync conflict] My Edit', 'My body');
	});

	it('does NOT call update when there is a conflict', async () => {
		const note = fakeCachedNote({ id: 7, server_updated_at: '2024-01-01T00:00:00Z' });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.get).mockResolvedValue(fakeServerNote({ id: 7, updated_at: '2024-01-02T00:00:00Z' }));
		vi.mocked(api.notes.create).mockResolvedValue(fakeServerNote({ id: 999 }));

		await syncOfflineChanges('heartbeat', 1);

		expect(api.notes.update).not.toHaveBeenCalled();
	});

	it('stores the server version in cache after a conflict', async () => {
		const note = fakeCachedNote({ id: 7, server_updated_at: '2024-01-01T00:00:00Z' });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		const serverNote = fakeServerNote({ id: 7, title: 'Server Title', body: 'Server Body', updated_at: '2024-01-02T00:00:00Z' });
		vi.mocked(api.notes.get).mockResolvedValue(serverNote);
		vi.mocked(api.notes.create).mockResolvedValue(fakeServerNote({ id: 999 }));

		await syncOfflineChanges('heartbeat', 1);

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

		await syncOfflineChanges('heartbeat', 1);

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

		await syncOfflineChanges('heartbeat', 1);

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

		const result = await syncOfflineChanges('heartbeat', 1);

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

		const result = await syncOfflineChanges('heartbeat', 1);

		expect(result.conflicts).toBe(1);
	});

	it('counts errors when a note sync throws', async () => {
		const note = fakeCachedNote({ id: -1, is_new: true });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.create).mockRejectedValue(new Error('Network down'));

		const result = await syncOfflineChanges('heartbeat', 1);

		expect(result.errors).toBe(1);
	});

	it('accepts a trigger parameter and echoes it in the result', async () => {
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([]);

		const result = await syncOfflineChanges('manual', 1);

		expect(result.trigger).toBe('manual');
	});

	it('logs a summary line to console.info after each run', async () => {
		const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([]);

		await syncOfflineChanges('heartbeat', 1);

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

		await syncOfflineChanges('heartbeat', 1);

		// Should have attempted both
		expect(api.notes.create).toHaveBeenCalledTimes(2);
	});

	it('returns ID mappings for newly created notes', async () => {
		const note = fakeCachedNote({ id: -1000, is_new: true });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.create).mockResolvedValue(fakeServerNote({ id: 99, updated_at: '2024-01-03T00:00:00Z' }));

		const result = await syncOfflineChanges('heartbeat', 1);

		expect(result.mappings).toEqual([{ tempId: -1000, serverId: 99 }]);
	});

	it('prevents concurrent sync runs — second call is skipped immediately', async () => {
		const note = fakeCachedNote({ id: 5 });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.get).mockResolvedValue(fakeServerNote({ id: 5, updated_at: '2024-01-01T00:00:00Z' }));
		vi.mocked(api.notes.update).mockResolvedValue(fakeServerNote({ id: 5, updated_at: '2024-01-05T00:00:00Z' }));

		const [, r2] = await Promise.all([syncOfflineChanges('heartbeat', 1), syncOfflineChanges('heartbeat', 1)]);

		// Second call skipped entirely; note was only synced once
		expect(api.notes.get).toHaveBeenCalledTimes(1);
		expect(r2.skipped).toBe(true);
		expect(r2.mappings).toEqual([]);
	});
});

describe('syncOfflineChanges — ownership guard', () => {
	it('refuses to push when the offline store belongs to a different user', async () => {
		const note = fakeCachedNote({ id: 5 });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(offlineDB.getOfflineOwner).mockResolvedValue(2); // store owned by user 2

		const result = await syncOfflineChanges('heartbeat', 1); // session is user 1

		expect(result.skipped).toBe(true);
		expect(result.reason).toBe('owner-mismatch');
		expect(api.notes.create).not.toHaveBeenCalled();
		expect(api.notes.update).not.toHaveBeenCalled();
		expect(api.notes.get).not.toHaveBeenCalled();
	});

	it('refuses to push when there is no authenticated user', async () => {
		const note = fakeCachedNote({ id: 5 });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);

		const result = await syncOfflineChanges('heartbeat', null);

		expect(result.skipped).toBe(true);
		expect(result.reason).toBe('no-user');
		expect(api.notes.create).not.toHaveBeenCalled();
		expect(api.notes.update).not.toHaveBeenCalled();
	});

	it('adopts a legacy store with no recorded owner and proceeds', async () => {
		const note = fakeCachedNote({ id: -1000, is_new: true });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(offlineDB.getOfflineOwner).mockResolvedValue(null);
		vi.mocked(api.notes.create).mockResolvedValue(fakeServerNote({ id: 9 }));

		const result = await syncOfflineChanges('heartbeat', 7);

		expect(offlineDB.setOfflineOwner).toHaveBeenCalledWith(fakeDB, 7);
		expect(result.skipped).toBe(false);
		expect(api.notes.create).toHaveBeenCalled();
	});

	it('pushes normally when the owner matches the current user', async () => {
		const note = fakeCachedNote({ id: -1000, is_new: true });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(offlineDB.getOfflineOwner).mockResolvedValue(1);
		vi.mocked(api.notes.create).mockResolvedValue(fakeServerNote({ id: 9 }));

		const result = await syncOfflineChanges('heartbeat', 1);

		expect(result.skipped).toBe(false);
		expect(api.notes.create).toHaveBeenCalled();
	});
});

describe('syncOfflineChanges — offline deletes', () => {
	it('replays an offline delete of a server note and drops the cache entry', async () => {
		const note = fakeCachedNote({ id: 7, deleted_offline: true });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.delete).mockResolvedValue(undefined);

		const result = await syncOfflineChanges('online', 1);

		expect(api.notes.delete).toHaveBeenCalledWith(7);
		expect(offlineDB.deleteNote).toHaveBeenCalledWith(fakeDB, 7);
		expect(result.pushed.deleted).toBe(1);
		expect(result.errors).toBe(0);
	});

	it('discards an offline-created note deleted before it ever synced (no API call)', async () => {
		const note = fakeCachedNote({ id: -500, is_new: true, deleted_offline: true });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);

		const result = await syncOfflineChanges('online', 1);

		expect(api.notes.delete).not.toHaveBeenCalled();
		expect(offlineDB.deleteNote).toHaveBeenCalledWith(fakeDB, -500);
		expect(result.pushed.deleted).toBe(1);
	});

	it('delete wins when both deleted_offline and archived_offline are set', async () => {
		const note = fakeCachedNote({ id: 7, deleted_offline: true, archived_offline: true });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.delete).mockResolvedValue(undefined);

		await syncOfflineChanges('online', 1);

		expect(api.notes.delete).toHaveBeenCalledWith(7);
		expect(api.notes.archive).not.toHaveBeenCalled();
	});

	it('a locked delete clears a stale archive intent instead of archiving on the next sync', async () => {
		const note = fakeCachedNote({ id: 7, deleted_offline: true, archived_offline: true });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.delete).mockRejectedValue(new ApiError(423, 'note is locked'));

		const result = await syncOfflineChanges('online', 1);

		expect(offlineDB.upsertNote).toHaveBeenCalledWith(fakeDB, expect.objectContaining({
			id: 7,
			locked: true,
			deleted_offline: false,
			archived_offline: false,
		}));
		expect(offlineDB.deleteNote).not.toHaveBeenCalled();
		expect(result.locked).toBe(1);
		expect(result.errors).toBe(0);
	});

	it('keeps the flagged note for retry when the delete call fails', async () => {
		const note = fakeCachedNote({ id: 7, deleted_offline: true });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.delete).mockRejectedValue(new Error('network'));

		const result = await syncOfflineChanges('online', 1);

		expect(offlineDB.deleteNote).not.toHaveBeenCalled();
		expect(result.errors).toBe(1);
		expect(result.pushed.deleted).toBe(0);
	});
});

describe('syncOfflineChanges — offline archives', () => {
	it('pushes local content then archives a server note, dropping the cache entry', async () => {
		const note = fakeCachedNote({ id: 8, title: 'Edited', body: 'Offline edit', archived_offline: true });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		// Server unchanged since our last sync — the content push is clean.
		vi.mocked(api.notes.get).mockResolvedValue(fakeServerNote({ id: 8, updated_at: '2024-01-01T00:00:00Z' }));
		vi.mocked(api.notes.update).mockResolvedValue(fakeServerNote({ id: 8 }));
		vi.mocked(api.notes.archive).mockResolvedValue(undefined);

		const result = await syncOfflineChanges('online', 1);

		expect(api.notes.update).toHaveBeenCalledWith(8, { title: 'Edited', body: 'Offline edit' });
		expect(api.notes.archive).toHaveBeenCalledWith(8);
		expect(offlineDB.deleteNote).toHaveBeenCalledWith(fakeDB, 8);
		expect(result.pushed.archived).toBe(1);
	});

	it('creates then archives an offline-created note that was archived before syncing', async () => {
		const note = fakeCachedNote({ id: -600, is_new: true, title: 'New', body: 'B', archived_offline: true });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.create).mockResolvedValue(fakeServerNote({ id: 42, title: 'New', body: 'B' }));
		vi.mocked(api.notes.archive).mockResolvedValue(undefined);

		const result = await syncOfflineChanges('online', 1);

		expect(api.notes.create).toHaveBeenCalledWith('New', 'B');
		expect(api.notes.archive).toHaveBeenCalledWith(42);
		expect(offlineDB.deleteNote).toHaveBeenCalledWith(fakeDB, -600);
		expect(result.pushed.archived).toBe(1);
	});

	it('keeps the flagged note for retry when the archive call fails', async () => {
		const note = fakeCachedNote({ id: 8, is_dirty: false, archived_offline: true });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.archive).mockRejectedValue(new Error('network'));

		const result = await syncOfflineChanges('online', 1);

		expect(offlineDB.deleteNote).not.toHaveBeenCalled();
		expect(result.errors).toBe(1);
		expect(result.pushed.archived).toBe(0);
	});
});

describe('syncOfflineChanges — archive replay conflict safety', () => {
	it('a plain archive (no content edits) never pushes cached title/body', async () => {
		const note = fakeCachedNote({ id: 9, is_dirty: false, archived_offline: true });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.archive).mockResolvedValue(undefined);

		const result = await syncOfflineChanges('online', 1);

		expect(api.notes.get).not.toHaveBeenCalled();
		expect(api.notes.update).not.toHaveBeenCalled();
		expect(api.notes.archive).toHaveBeenCalledWith(9);
		expect(result.pushed.archived).toBe(1);
	});

	it('preserves offline edits as a conflict note when the server changed too, archiving the server version untouched', async () => {
		const note = fakeCachedNote({
			id: 9, title: 'My Edit', body: 'My body',
			archived_offline: true, server_updated_at: '2024-01-01T00:00:00Z',
		});
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.get).mockResolvedValue(
			fakeServerNote({ id: 9, updated_at: '2024-01-02T00:00:00Z' }) // server moved
		);
		vi.mocked(api.notes.create).mockResolvedValue(fakeServerNote({ id: 999 }));
		vi.mocked(api.notes.archive).mockResolvedValue(undefined);

		const result = await syncOfflineChanges('online', 1);

		expect(api.notes.update).not.toHaveBeenCalled();
		expect(api.notes.create).toHaveBeenCalledWith('[sync conflict] My Edit', 'My body');
		expect(api.notes.archive).toHaveBeenCalledWith(9);
		expect(result.conflicts).toBe(1);
		expect(result.pushed.archived).toBe(1);
	});
});

describe('syncOfflineChanges — replay tolerates notes already gone server-side', () => {
	it('a 404 on delete replay counts as done and drops the cache entry', async () => {
		const note = fakeCachedNote({ id: 7, deleted_offline: true });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.delete).mockRejectedValue(new ApiError(404, 'not found'));

		const result = await syncOfflineChanges('online', 1);

		expect(offlineDB.deleteNote).toHaveBeenCalledWith(fakeDB, 7);
		expect(result.pushed.deleted).toBe(1);
		expect(result.errors).toBe(0);
	});

	it('a 404 on archive replay counts as done and drops the cache entry', async () => {
		const note = fakeCachedNote({ id: 8, is_dirty: false, archived_offline: true });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.archive).mockRejectedValue(new ApiError(404, 'not found'));

		const result = await syncOfflineChanges('online', 1);

		expect(offlineDB.deleteNote).toHaveBeenCalledWith(fakeDB, 8);
		expect(result.pushed.archived).toBe(1);
		expect(result.errors).toBe(0);
	});

	it('a non-404 server error still leaves the flag in place for retry', async () => {
		const note = fakeCachedNote({ id: 7, deleted_offline: true });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.delete).mockRejectedValue(new ApiError(500, 'boom'));

		const result = await syncOfflineChanges('online', 1);

		expect(offlineDB.deleteNote).not.toHaveBeenCalled();
		expect(result.errors).toBe(1);
	});
});

describe('syncOfflineChanges — flag reconcile (star/pin/lock toggled offline)', () => {
	it('toggles only the flags that differ from the server (desired state, not blind replay)', async () => {
		// Desired: unlocked + starred. Server: locked + starred.
		const note = fakeCachedNote({ id: 5, is_dirty: false, flags_dirty: true, starred: true, pinned: false, locked: false });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.get).mockResolvedValue(fakeServerNote({ id: 5, starred: true, pinned: false, locked: true }));
		vi.mocked(api.notes.toggleLock).mockResolvedValue(fakeServerNote({ id: 5, starred: true, pinned: false, locked: false, updated_at: '2024-01-06T00:00:00Z' }));
		vi.mocked(offlineDB.getNote).mockResolvedValue(note);

		const result = await syncOfflineChanges('online', 1);

		expect(api.notes.toggleLock).toHaveBeenCalledWith(5);
		expect(api.notes.toggleStar).not.toHaveBeenCalled();
		expect(api.notes.togglePin).not.toHaveBeenCalled();
		expect(api.notes.update).not.toHaveBeenCalled(); // no content push for flags-only
		expect(offlineDB.upsertNote).toHaveBeenCalledWith(fakeDB, expect.objectContaining({
			id: 5,
			locked: false,
			flags_dirty: false,
			server_updated_at: '2024-01-06T00:00:00Z',
		}));
		expect(result.pushed.flags).toBe(1);
	});

	it('clears the flag without any toggle calls when server already matches', async () => {
		const note = fakeCachedNote({ id: 5, is_dirty: false, flags_dirty: true, starred: false, pinned: false, locked: false });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.get).mockResolvedValue(fakeServerNote({ id: 5, starred: false, pinned: false, locked: false }));
		vi.mocked(offlineDB.getNote).mockResolvedValue(note);

		const result = await syncOfflineChanges('online', 1);

		expect(api.notes.toggleStar).not.toHaveBeenCalled();
		expect(api.notes.togglePin).not.toHaveBeenCalled();
		expect(api.notes.toggleLock).not.toHaveBeenCalled();
		expect(offlineDB.upsertNote).toHaveBeenCalledWith(fakeDB, expect.objectContaining({ flags_dirty: false }));
		expect(result.pushed.flags).toBe(1);
	});

	it('reconciles flags BEFORE pushing content when both are dirty (fast-forwarding past its own updated_at bumps)', async () => {
		const note = fakeCachedNote({
			id: 5, title: 'Edited', body: 'B', is_dirty: true, flags_dirty: true,
			starred: true, server_updated_at: '2024-01-01T00:00:00Z',
		});
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.get)
			// flag reconcile's GET: server unchanged since our snapshot
			.mockResolvedValueOnce(fakeServerNote({ id: 5, updated_at: '2024-01-01T00:00:00Z', starred: false }))
			// content push's GET: updated_at bumped by OUR OWN toggle — the
			// fast-forwarded baseline must treat this as a clean push
			.mockResolvedValueOnce(fakeServerNote({ id: 5, updated_at: '2024-01-06T00:00:00Z', starred: true }));
		vi.mocked(api.notes.toggleStar).mockResolvedValue(fakeServerNote({ id: 5, starred: true, updated_at: '2024-01-06T00:00:00Z' }));
		vi.mocked(api.notes.update).mockResolvedValue(fakeServerNote({ id: 5, updated_at: '2024-01-07T00:00:00Z', starred: true }));

		const result = await syncOfflineChanges('online', 1);

		expect(api.notes.toggleStar).toHaveBeenCalledWith(5);
		expect(api.notes.update).toHaveBeenCalledWith(5, { title: 'Edited', body: 'B' });
		// flags first, then content
		const starOrder = vi.mocked(api.notes.toggleStar).mock.invocationCallOrder[0];
		const updateOrder = vi.mocked(api.notes.update).mock.invocationCallOrder[0];
		expect(starOrder).toBeLessThan(updateOrder);
		expect(result.pushed.updated).toBe(1);
		expect(result.pushed.flags).toBe(1);
		expect(result.conflicts).toBe(0); // our own toggle bump is NOT a conflict
	});

	it("keeps the server's authoritative pin_order after an offline pin syncs", async () => {
		// Pinned offline: the client guessed a top-of-stack slot; the server
		// assigns the real one. The cache must end up holding the server's.
		const note = fakeCachedNote({
			id: 5, is_dirty: false, flags_dirty: true, pinned: true, pin_order: -1,
			flags_toggled: { pinned: true },
		});
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.get).mockResolvedValue(
			fakeServerNote({ id: 5, pinned: false, pin_order: 0 })
		);
		vi.mocked(api.notes.togglePin).mockResolvedValue(
			fakeServerNote({ id: 5, pinned: true, pin_order: -7, updated_at: '2024-01-06T00:00:00Z' })
		);
		vi.mocked(offlineDB.getNote).mockResolvedValue(note);

		await syncOfflineChanges('online', 1);

		expect(api.notes.togglePin).toHaveBeenCalledWith(5);
		expect(offlineDB.upsertNote).toHaveBeenCalledWith(
			fakeDB,
			expect.objectContaining({ id: 5, pinned: true, pin_order: -7 })
		);
	});

	it('drops the entry when the note is already gone server-side', async () => {
		const note = fakeCachedNote({ id: 5, is_dirty: false, flags_dirty: true });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.get).mockRejectedValue(new ApiError(404, 'not found'));

		const result = await syncOfflineChanges('online', 1);

		expect(offlineDB.deleteNote).toHaveBeenCalledWith(fakeDB, 5);
		expect(result.errors).toBe(0);
	});
});

describe('syncOfflineChanges — archive replay is checkpointed and flag-aware', () => {
	it('reconciles flags toggled offline before archiving instead of dropping them', async () => {
		// Offline: user starred the note, then archived it.
		const note = fakeCachedNote({ id: 9, is_dirty: false, flags_dirty: true, starred: true, archived_offline: true });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.get).mockResolvedValue(fakeServerNote({ id: 9, starred: false }));
		vi.mocked(api.notes.toggleStar).mockResolvedValue(fakeServerNote({ id: 9, starred: true }));
		vi.mocked(api.notes.archive).mockResolvedValue(undefined);

		const result = await syncOfflineChanges('online', 1);

		expect(api.notes.toggleStar).toHaveBeenCalledWith(9);
		expect(api.notes.archive).toHaveBeenCalledWith(9);
		expect(offlineDB.deleteNote).toHaveBeenCalledWith(fakeDB, 9);
		expect(result.pushed.flags).toBe(1);
		expect(result.pushed.archived).toBe(1);
	});

	it('checkpoints the server-side create so a failed archive never re-creates the note', async () => {
		const note = fakeCachedNote({ id: -600, is_new: true, title: 'New', body: 'B', archived_offline: true });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.create).mockResolvedValue(fakeServerNote({ id: 42, title: 'New', body: 'B' }));
		vi.mocked(api.notes.archive).mockRejectedValue(new Error('network dropped'));

		const result = await syncOfflineChanges('online', 1);

		// The create landed and was checkpointed: entry re-keyed to the server
		// id with is_new cleared, archived_offline retained for the retry.
		expect(offlineDB.deleteNote).toHaveBeenCalledWith(fakeDB, -600);
		expect(offlineDB.upsertNote).toHaveBeenCalledWith(fakeDB, expect.objectContaining({
			id: 42, is_new: false, archived_offline: true,
		}));
		expect(result.errors).toBe(1);

		// Retry run with the checkpointed entry: only the archive re-runs.
		vi.mocked(api.notes.create).mockClear();
		vi.mocked(api.notes.archive).mockReset();
		vi.mocked(api.notes.archive).mockResolvedValue(undefined);
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([
			fakeCachedNote({ id: 42, is_new: false, is_dirty: false, archived_offline: true }),
		]);

		const retry = await syncOfflineChanges('online', 1);

		expect(api.notes.create).not.toHaveBeenCalled(); // no duplicate
		expect(api.notes.archive).toHaveBeenCalledWith(42);
		expect(retry.pushed.archived).toBe(1);
		expect(retry.errors).toBe(0);
	});

	it('checkpoints a successful content push so a failed archive does not mint a spurious conflict on retry', async () => {
		const note = fakeCachedNote({
			id: 8, title: 'Edited', body: 'B', is_dirty: true,
			archived_offline: true, server_updated_at: '2024-01-01T00:00:00Z',
		});
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.get).mockResolvedValue(fakeServerNote({ id: 8, updated_at: '2024-01-01T00:00:00Z' }));
		vi.mocked(api.notes.update).mockResolvedValue(fakeServerNote({ id: 8, updated_at: '2024-01-05T00:00:00Z' }));
		vi.mocked(api.notes.archive).mockRejectedValue(new Error('network dropped'));

		const result = await syncOfflineChanges('online', 1);

		// The push was checkpointed with the fresh conflict baseline: a retry
		// sees is_dirty false and matching server_updated_at → archive only.
		expect(offlineDB.upsertNote).toHaveBeenCalledWith(fakeDB, expect.objectContaining({
			id: 8, is_dirty: false, server_updated_at: '2024-01-05T00:00:00Z', archived_offline: true,
		}));
		expect(result.errors).toBe(1);
	});
});

describe('syncOfflineChanges — new-note replay preserves offline flag toggles', () => {
	it('carries flags_dirty and desired flag values through the re-keyed entry', async () => {
		// Offline-created note that was also starred offline.
		const note = fakeCachedNote({ id: -700, is_new: true, flags_dirty: true, starred: true, title: 'New', body: 'B' });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.create).mockResolvedValue(fakeServerNote({ id: 55, title: 'New', body: 'B', starred: false }));
		vi.mocked(api.notes.get).mockResolvedValue(fakeServerNote({ id: 55, starred: false }));
		vi.mocked(api.notes.toggleStar).mockResolvedValue(fakeServerNote({ id: 55, starred: true }));
		vi.mocked(offlineDB.getNote).mockResolvedValue({ ...note, id: 55, is_new: false });

		const result = await syncOfflineChanges('online', 1);

		// The re-keyed entry keeps the DESIRED flags + flags_dirty, so a
		// failure before the reconcile would still retry next sync.
		expect(offlineDB.upsertNote).toHaveBeenCalledWith(fakeDB, expect.objectContaining({
			id: 55, is_new: false, flags_dirty: true, starred: true,
		}));
		// And the reconcile then pushes the star via the mapping.
		expect(api.notes.toggleStar).toHaveBeenCalledWith(55);
		expect(result.pushed.created).toBe(1);
		expect(result.pushed.flags).toBe(1);
	});
});

describe('syncOfflineChanges — locked-note wedges (regression: sync stuck on NOT SYNCED)', () => {
	it('unlock + edit made offline: the unlock lands first so the content PUT is not rejected with 423', async () => {
		// The reported wedge: user unlocks a note offline, edits it, then
		// reconnects. The PUT used to run first, bounce off the still-locked
		// note with 423 on every heartbeat, and sync never went green.
		const note = fakeCachedNote({
			id: 5, title: 'Edited', body: 'B', is_dirty: true, flags_dirty: true,
			locked: false, server_updated_at: '2024-01-01T00:00:00Z',
		});
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.get)
			.mockResolvedValueOnce(fakeServerNote({ id: 5, locked: true, updated_at: '2024-01-01T00:00:00Z' }))
			.mockResolvedValueOnce(fakeServerNote({ id: 5, locked: false, updated_at: '2024-01-06T00:00:00Z' }));
		vi.mocked(api.notes.toggleLock).mockResolvedValue(fakeServerNote({ id: 5, locked: false, updated_at: '2024-01-06T00:00:00Z' }));
		vi.mocked(api.notes.update).mockResolvedValue(fakeServerNote({ id: 5, locked: false, updated_at: '2024-01-07T00:00:00Z' }));

		const result = await syncOfflineChanges('online', 1);

		const unlockOrder = vi.mocked(api.notes.toggleLock).mock.invocationCallOrder[0];
		const updateOrder = vi.mocked(api.notes.update).mock.invocationCallOrder[0];
		expect(unlockOrder).toBeLessThan(updateOrder);
		expect(result.pushed.updated).toBe(1);
		expect(result.pushed.flags).toBe(1);
		expect(result.errors).toBe(0);
	});

	it('a PUT rejected with 423 (locked from another device) preserves the edit as a conflict note instead of retrying forever', async () => {
		const note = fakeCachedNote({ id: 5, title: 'Edited', body: 'B', server_updated_at: '2024-01-01T00:00:00Z' });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.get).mockResolvedValue(
			fakeServerNote({ id: 5, title: 'Server', body: 'S', locked: true, updated_at: '2024-01-01T00:00:00Z' })
		);
		vi.mocked(api.notes.update).mockRejectedValue(new ApiError(423, 'note is locked'));
		vi.mocked(api.notes.create).mockResolvedValue(fakeServerNote({ id: 999 }));

		const result = await syncOfflineChanges('online', 1);

		expect(api.notes.create).toHaveBeenCalledWith('[sync conflict] Edited', 'B');
		// Cache entry accepts the server version and goes clean — no wedge.
		expect(offlineDB.upsertNote).toHaveBeenCalledWith(fakeDB, expect.objectContaining({
			id: 5, is_dirty: false, title: 'Server', locked: true,
		}));
		// Counted as `locked`, not `conflicts` — the sidebar must be able to
		// say "locked 1" rather than an opaque error/conflict count.
		expect(result.locked).toBe(1);
		expect(result.conflicts).toBe(0);
		expect(result.errors).toBe(0);
	});

	it('counts a 423 on the localWins conflict branch as locked, preserving the local edit', async () => {
		const note = fakeCachedNote({
			id: 5, title: 'Mine', body: 'Mine',
			server_updated_at: '2024-01-01T00:00:00Z',
			local_updated_at: '2024-01-09T00:00:00Z',
		});
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.get).mockResolvedValue(
			fakeServerNote({ id: 5, title: 'Theirs', body: 'Theirs', locked: true, updated_at: '2024-01-05T00:00:00Z' })
		);
		vi.mocked(api.notes.update).mockRejectedValue(new ApiError(423, 'note is locked'));
		vi.mocked(api.notes.create).mockResolvedValue(fakeServerNote({ id: 999 }));

		const result = await syncOfflineChanges('online', 1);

		expect(api.notes.create).toHaveBeenCalledWith('[sync conflict] Mine', 'Mine');
		expect(offlineDB.upsertNote).toHaveBeenCalledWith(fakeDB, expect.objectContaining({
			id: 5, is_dirty: false, locked: true,
		}));
		expect(result.locked).toBe(1);
		expect(result.errors).toBe(0);
	});

	it('delete of a note unlocked offline: a 423 triggers unlock-then-delete instead of wedging', async () => {
		const note = fakeCachedNote({
			id: 7, deleted_offline: true, flags_dirty: true, locked: false,
			flags_toggled: { locked: true },
		});
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.delete)
			.mockRejectedValueOnce(new ApiError(423, 'note is locked'))
			.mockResolvedValueOnce(undefined);
		vi.mocked(api.notes.toggleLock).mockResolvedValue(fakeServerNote({ id: 7, locked: false }));

		const result = await syncOfflineChanges('online', 1);

		expect(api.notes.toggleLock).toHaveBeenCalledWith(7);
		expect(api.notes.delete).toHaveBeenCalledTimes(2);
		expect(offlineDB.deleteNote).toHaveBeenCalledWith(fakeDB, 7);
		expect(result.pushed.deleted).toBe(1);
		expect(result.errors).toBe(0);
	});

	it('delete of a note locked server-side (auto-locked while offline) abandons the delete instead of retrying forever', async () => {
		// No offline unlock was made: the lock is the server's, so the delete
		// must not be forced through. It must also not wedge the queue.
		const note = fakeCachedNote({ id: 9, deleted_offline: true, locked: false });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.delete).mockRejectedValue(new ApiError(423, 'note is locked'));

		const result = await syncOfflineChanges('online', 1);

		expect(api.notes.toggleLock).not.toHaveBeenCalled();
		expect(api.notes.delete).toHaveBeenCalledTimes(1);
		// The entry survives, flagged locked so the UI explains itself, and
		// with the delete intent dropped so it leaves the dirty queue.
		expect(offlineDB.deleteNote).not.toHaveBeenCalled();
		expect(offlineDB.upsertNote).toHaveBeenCalledWith(fakeDB, expect.objectContaining({
			id: 9, locked: true, deleted_offline: false,
		}));
		expect(result.locked).toBe(1);
		expect(result.pushed.deleted).toBe(0);
		expect(result.errors).toBe(0);
	});
});

describe('syncOfflineChanges — lock safety and ordering', () => {
	it('an offline edit + LOCK applies the lock AFTER the content push, not before', async () => {
		// Locking first would make our own PUT bounce with a 423 and shunt
		// the edit into a spurious conflict copy.
		const note = fakeCachedNote({
			id: 5, title: 'Edited', body: 'B', is_dirty: true, flags_dirty: true,
			locked: true, flags_toggled: { locked: true },
			server_updated_at: '2024-01-01T00:00:00Z',
		});
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.get).mockResolvedValue(
			fakeServerNote({ id: 5, locked: false, updated_at: '2024-01-01T00:00:00Z' })
		);
		vi.mocked(api.notes.update).mockResolvedValue(fakeServerNote({ id: 5, updated_at: '2024-01-05T00:00:00Z' }));
		vi.mocked(api.notes.toggleLock).mockResolvedValue(fakeServerNote({ id: 5, locked: true, updated_at: '2024-01-05T00:00:00Z' }));

		const result = await syncOfflineChanges('online', 1);

		expect(api.notes.update).toHaveBeenCalledWith(5, { title: 'Edited', body: 'B' });
		expect(api.notes.toggleLock).toHaveBeenCalledWith(5);
		const updateOrder = vi.mocked(api.notes.update).mock.invocationCallOrder[0];
		const lockOrder = vi.mocked(api.notes.toggleLock).mock.invocationCallOrder[0];
		expect(updateOrder).toBeLessThan(lockOrder);
		expect(result.conflicts).toBe(0);
		expect(result.errors).toBe(0);
		expect(result.pushed.updated).toBe(1);
		expect(result.pushed.flags).toBe(1);
	});

	it('reconcile never touches a flag the user did not toggle — a stale cached locked:false cannot strip another device lock', async () => {
		// Device A locked the note; this device's cache predates that and the
		// user only starred it offline.
		const note = fakeCachedNote({
			id: 5, is_dirty: false, flags_dirty: true,
			starred: true, locked: false, flags_toggled: { starred: true },
		});
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.get).mockResolvedValue(fakeServerNote({ id: 5, starred: false, locked: true }));
		vi.mocked(api.notes.toggleStar).mockResolvedValue(fakeServerNote({ id: 5, starred: true, locked: true }));

		const result = await syncOfflineChanges('online', 1);

		expect(api.notes.toggleStar).toHaveBeenCalledWith(5);
		expect(api.notes.toggleLock).not.toHaveBeenCalled();
		expect(result.errors).toBe(0);
	});

	it('delete replay never force-unlocks when the lock flag itself was not toggled offline', async () => {
		// Same stale-cache setup, but the user deleted the note. The 423 must
		// NOT trigger unlock-then-delete — the lock was set by another device.
		const note = fakeCachedNote({
			id: 7, deleted_offline: true, flags_dirty: true,
			starred: true, locked: false, flags_toggled: { starred: true },
		});
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.delete).mockRejectedValue(new ApiError(423, 'note is locked'));

		const result = await syncOfflineChanges('online', 1);

		expect(api.notes.toggleLock).not.toHaveBeenCalled();
		expect(offlineDB.deleteNote).not.toHaveBeenCalled();
		// A server-side lock is a settled refusal, not a transient error.
		expect(result.locked).toBe(1);
		expect(result.errors).toBe(0);
	});

	it('archive replay of a locked+edited note preserves the edit as a conflict instead of wedging on 423', async () => {
		// The archive path shares pushContentCheckpoint, so the 423 fallback
		// applies there too.
		const note = fakeCachedNote({
			id: 8, title: 'Edited', body: 'B', is_dirty: true, archived_offline: true,
			server_updated_at: '2024-01-01T00:00:00Z',
		});
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.get).mockResolvedValue(
			fakeServerNote({ id: 8, title: 'Server', body: 'S', locked: true, updated_at: '2024-01-01T00:00:00Z' })
		);
		vi.mocked(api.notes.update).mockRejectedValue(new ApiError(423, 'note is locked'));
		vi.mocked(api.notes.create).mockResolvedValue(fakeServerNote({ id: 999 }));
		vi.mocked(api.notes.archive).mockResolvedValue(undefined);

		const result = await syncOfflineChanges('online', 1);

		expect(api.notes.create).toHaveBeenCalledWith('[sync conflict] Edited', 'B');
		expect(api.notes.archive).toHaveBeenCalledWith(8);
		expect(offlineDB.deleteNote).toHaveBeenCalledWith(fakeDB, 8);
		expect(result.locked).toBe(1);
		expect(result.errors).toBe(0);
		expect(result.pushed.archived).toBe(1);
	});
});

describe('syncOfflineChanges — pin_order carries through every cache rebuild', () => {
	it("takes the server's pin_order when a new offline note is created", async () => {
		const note = fakeCachedNote({ id: -1000, is_new: true, title: 'New', pinned: false });
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.create).mockResolvedValue(
			fakeServerNote({ id: 42, title: 'New', pinned: true, pin_order: -2 })
		);

		await syncOfflineChanges('online', 1);

		expect(offlineDB.upsertNote).toHaveBeenCalledWith(
			fakeDB,
			expect.objectContaining({ id: 42, pinned: true, pin_order: -2 })
		);
	});

	it("takes the server's pin_order when a lock conflict preserves the local edit", async () => {
		// Server changed under us and wins; its pin_order comes with it.
		const note = fakeCachedNote({
			id: 5, is_dirty: true, title: 'Mine', body: 'Mine',
			server_updated_at: '2024-01-01T00:00:00Z',
			local_updated_at: '2024-01-02T00:00:00Z',
			pin_order: -1,
		});
		vi.mocked(offlineDB.getDirtyNotes).mockResolvedValue([note]);
		vi.mocked(api.notes.get).mockResolvedValue(
			fakeServerNote({
				id: 5, title: 'Theirs', body: 'Theirs', pinned: true, pin_order: -9,
				updated_at: '2024-01-05T00:00:00Z',
			})
		);
		vi.mocked(api.notes.update).mockRejectedValue(new ApiError(423, 'locked'));
		vi.mocked(api.notes.create).mockResolvedValue(fakeServerNote({ id: 99 }));

		await syncOfflineChanges('online', 1);

		expect(offlineDB.upsertNote).toHaveBeenCalledWith(
			fakeDB,
			expect.objectContaining({ id: 5, pin_order: -9 })
		);
	});
});
