import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { api } from './api';
import { acknowledgeCachedSave } from './noteSave';
import { clearAllNotes, getNote, openOfflineDB, setOfflineOwner, upsertNote, type CachedNote } from './offlineDB';
import { syncOfflineChanges } from './offlineSync';

// Only the network boundary is mocked; cache acknowledgement and sync use
// the same real IndexedDB records, including sync's whole-note conflict check.
vi.mock('./api', async (importOriginal) => ({
	...(await importOriginal<typeof import('./api')>()),
	api: { notes: { get: vi.fn(), update: vi.fn(), create: vi.fn() } },
}));

const baseTime = '2026-09-15T10:00:00Z';
const localTime = '2026-09-15T11:00:00Z';
const serverTime = '2026-09-15T12:00:00Z';

beforeEach(async () => {
	vi.clearAllMocks();
	const db = await openOfflineDB();
	await clearAllNotes(db);
	await setOfflineOwner(db, 1);
	db.close();
});

describe('partial save followed by sync', () => {
	it.each(['title', 'body'] as const)('preserves a conflict copy for the dirty sibling after a successful %s save', async (field) => {
		const sibling = field === 'title' ? 'body' : 'title';
		const original: CachedNote = {
			id: 1, title: 'Original title', body: 'Original body', starred: false, pinned: false, tags: [],
			server_updated_at: baseTime, local_updated_at: localTime, is_dirty: true, is_new: false,
			[sibling]: 'Unsynced local edit',
		};
		const server = {
			id: 1, title: 'Original title', body: 'Original body', starred: false, pinned: false,
			locked: false, archived: false, created_at: baseTime, updated_at: serverTime,
			[field]: 'Successful partial save', [sibling]: 'Concurrent remote edit',
		};
		const db = await openOfflineDB();
		try {
			await upsertNote(db, acknowledgeCachedSave(original, field, server));
			vi.mocked(api.notes.get).mockResolvedValue(server);
			vi.mocked(api.notes.update).mockResolvedValue(server);
			vi.mocked(api.notes.create).mockResolvedValue({ ...server, id: 2 });

			const result = await syncOfflineChanges('manual', 1);

			expect(result.conflicts).toBe(1);
			expect(api.notes.update).not.toHaveBeenCalled(); // remote won; no silent overwrite
			const local = { ...original, [field]: server[field] };
			expect(api.notes.create).toHaveBeenCalledWith(`[sync conflict] ${local.title}`, local.body);
			expect(await getNote(db, 1)).toMatchObject({
				title: server.title, body: server.body, is_dirty: false, server_updated_at: serverTime,
			});
		} finally {
			db.close();
		}
	});
});
