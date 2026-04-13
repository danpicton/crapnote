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

		const mappings = await syncOfflineChanges();

		expect(mappings).toEqual([{ tempId: -1000, serverId: 99 }]);
	});
});
