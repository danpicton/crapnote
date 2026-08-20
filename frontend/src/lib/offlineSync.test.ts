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
		},
	},
};
});

vi.mock('$lib/offlineDB', () => ({
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
