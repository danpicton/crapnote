import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { api, ApiError } from './api';
import { clearAllNotes, getNote, openOfflineDB, setOfflineOwner, upsertNote, type CachedNote } from './offlineDB';
import { syncOfflineChanges } from './offlineSync';

vi.mock('./api', async (original) => ({
	...(await original<typeof import('./api')>()),
	api: { notes: { get: vi.fn(), create: vi.fn(), update: vi.fn(), toggleStar: vi.fn() } },
}));
const base = '2024-01-01T00:00:00Z';
const remoteTime = '2024-01-03T00:00:00Z';
const local = (overrides: Partial<CachedNote> = {}): CachedNote => ({
	id: 7, title: 'Sensitive draft', body: 'Sensitive local body', private: true,
	starred: true, pinned: false, tags: [], is_dirty: true, is_new: false,
	server_updated_at: base, local_updated_at: '2024-01-02T00:00:00Z',
	flags_dirty: true, flags_toggled: { starred: true }, ...overrides,
});
const remote = { id: 7, title: 'Remote', body: 'Remote body', private: false,
	starred: false, pinned: false, locked: false, archived: false, created_at: base, updated_at: remoteTime };

beforeEach(async () => {
	vi.resetAllMocks();
	const db = await openOfflineDB();
	await clearAllNotes(db);
	await setOfflineOwner(db, 1);
	db.close();
	vi.mocked(api.notes.get).mockResolvedValue(remote);
	vi.mocked(api.notes.toggleStar).mockResolvedValue({ ...remote, starred: true });
	vi.mocked(api.notes.create).mockResolvedValue({ ...remote, id: 8, private: true });
	vi.mocked(api.notes.update).mockResolvedValue({ ...remote, private: true });
});

describe('privacy across durable sync checkpoints', () => {
	it.each(['server', 'local', 'locked', 'retry'] as const)('protects cached private content when %s wins after flag reconciliation', async (winner) => {
		const db = await openOfflineDB();
		try {
			await upsertNote(db, local({ local_updated_at: winner === 'local' ? '2024-01-04T00:00:00Z' : '2024-01-02T00:00:00Z' }));
			if (winner === 'locked') {
				vi.mocked(api.notes.get).mockResolvedValue({ ...remote, updated_at: base, locked: true });
				vi.mocked(api.notes.toggleStar).mockResolvedValue({ ...remote, updated_at: base, starred: true, locked: true });
				vi.mocked(api.notes.update).mockRejectedValue(new ApiError(423, 'locked'));
			}
			if (winner === 'retry') {
				vi.mocked(api.notes.create).mockRejectedValueOnce(new Error('network unavailable'));
				expect((await syncOfflineChanges('manual', 1)).errors).toBe(1);
				expect(await getNote(db, 7)).toMatchObject({ private: true, is_dirty: true, flags_dirty: false });
			}
			const result = await syncOfflineChanges('manual', 1);
			expect(result.errors).toBe(0);
			expect(api.notes.create).toHaveBeenLastCalledWith(expect.stringContaining('[sync conflict]'), expect.any(String), true);
			if (winner === 'local') {
				expect(api.notes.update).toHaveBeenCalledWith(7, expect.objectContaining({ private: true }));
			}
		} finally { db.close(); }
	});

	it('checkpoints server privacy with the winning local content', async () => {
		const db = await openOfflineDB();
		try {
			await upsertNote(db, local({ private: false, flags_dirty: false, local_updated_at: '2024-01-04T00:00:00Z' }));
			vi.mocked(api.notes.get).mockResolvedValue({ ...remote, private: true });
			expect((await syncOfflineChanges('manual', 1)).errors).toBe(0);
			expect(await getNote(db, 7)).toMatchObject({ private: true, is_dirty: false });
		} finally { db.close(); }
	});

	it('creates an offline private note with privacy in the initial request', async () => {
		const db = await openOfflineDB();
		try {
			await upsertNote(db, local({ id: -1, is_new: true, flags_dirty: false }));
			expect((await syncOfflineChanges('manual', 1)).errors).toBe(0);
			expect(api.notes.create).toHaveBeenCalledWith('Sensitive draft', 'Sensitive local body', true);
		} finally { db.close(); }
	});
});
