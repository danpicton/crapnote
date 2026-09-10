import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
	clearLocalData,
	ensureOfflineOwner,
	persistSessionUser,
	readSessionUser,
	clearSessionUser,
	openOwnedOfflineDB,
	requireOwnedOfflineDB,
	OfflineOwnershipError,
} from './localData';
import { openOfflineDB, upsertNote, getAllNotes, getOfflineOwner, setOfflineOwner, deleteOfflineDB } from './offlineDB';

const makeNote = (id: number) => ({
	id,
	title: 'Secret',
	body: 'Body',
	starred: false,
	pinned: false,
	tags: [],
	server_updated_at: '2024-01-01T00:00:00Z',
	local_updated_at: '2024-01-01T00:00:00Z',
	is_dirty: true,
	is_new: false,
});

function stubCaches(keys: string[]) {
	const deleted: string[] = [];
	const cachesStub = {
		keys: vi.fn().mockResolvedValue(keys),
		delete: vi.fn(async (k: string) => {
			deleted.push(k);
			return true;
		}),
	};
	vi.stubGlobal('caches', cachesStub);
	return { cachesStub, deleted };
}

beforeEach(async () => {
	vi.unstubAllGlobals();
	await deleteOfflineDB();
});

describe('clearLocalData', () => {
	it('deletes crapnote-* Cache Storage entries and leaves others alone', async () => {
		const { deleted } = stubCaches(['crapnote-abc123', 'other-app-cache']);

		await clearLocalData();

		expect(deleted).toEqual(['crapnote-abc123']);
	});

	it('deletes the offline IndexedDB store', async () => {
		stubCaches([]);
		let db = await openOfflineDB();
		await upsertNote(db, makeNote(1));
		await setOfflineOwner(db, 42);
		db.close();

		await clearLocalData();

		// Re-opening creates a fresh, empty database.
		db = await openOfflineDB();
		expect(await getAllNotes(db)).toEqual([]);
		expect(await getOfflineOwner(db)).toBeNull();
		db.close();
	});

	it('does not throw when Cache Storage is unavailable', async () => {
		vi.stubGlobal('caches', undefined);
		await expect(clearLocalData()).resolves.toBeUndefined();
	});

	it('forgets the offline unlock material', async () => {
		stubCaches([]);
		localStorage.setItem('crapnote:offline-unlock', JSON.stringify({ v: 1 }));
		localStorage.setItem('crapnote:offline-unlock-attempts', JSON.stringify({ failures: 3 }));

		await clearLocalData();

		expect(localStorage.getItem('crapnote:offline-unlock')).toBeNull();
		expect(localStorage.getItem('crapnote:offline-unlock-attempts')).toBeNull();
	});

	it('forgets the persisted session user', async () => {
		stubCaches([]);
		persistSessionUser({ id: 5, username: 'alice', is_admin: false, created_at: '' });

		await clearLocalData();

		expect(readSessionUser()).toBeNull();
	});
});

describe('session user persistence', () => {
	it('round-trips the persisted user', () => {
		const user = { id: 5, username: 'alice', is_admin: true, created_at: '2024-01-01T00:00:00Z' };
		persistSessionUser(user);
		expect(readSessionUser()).toEqual(user);
	});

	it('returns null when nothing was persisted', () => {
		clearSessionUser();
		expect(readSessionUser()).toBeNull();
	});

	it('returns null for corrupt stored data', () => {
		localStorage.setItem('crapnote:session-user', 'not json');
		expect(readSessionUser()).toBeNull();
	});

	it('degrades safely when localStorage access is denied', () => {
		const denied = () => {
			throw new Error('SecurityError: storage disabled');
		};
		vi.stubGlobal('localStorage', {
			getItem: denied,
			setItem: denied,
			removeItem: denied,
		});
		const user = { id: 5, username: 'alice', is_admin: false, created_at: '' };

		expect(() => persistSessionUser(user)).not.toThrow();
		expect(readSessionUser()).toBeNull();
		expect(() => clearSessionUser()).not.toThrow();
	});
});

describe('ensureOfflineOwner', () => {
	it('stamps the owner on a fresh store', async () => {
		stubCaches([]);
		await ensureOfflineOwner(7);

		const db = await openOfflineDB();
		expect(await getOfflineOwner(db)).toBe(7);
		db.close();
	});

	it('keeps cached notes when the same user returns', async () => {
		stubCaches([]);
		let db = await openOfflineDB();
		await setOfflineOwner(db, 7);
		await upsertNote(db, makeNote(1));
		db.close();

		await ensureOfflineOwner(7);

		db = await openOfflineDB();
		expect((await getAllNotes(db)).length).toBe(1);
		db.close();
	});

	it('wipes the previous user\'s notes and caches when a different user logs in', async () => {
		const { deleted } = stubCaches(['crapnote-v1']);
		let db = await openOfflineDB();
		await setOfflineOwner(db, 7);
		await upsertNote(db, makeNote(1));
		db.close();

		await ensureOfflineOwner(8);

		db = await openOfflineDB();
		expect(await getAllNotes(db)).toEqual([]);
		expect(await getOfflineOwner(db)).toBe(8);
		expect(deleted).toEqual(['crapnote-v1']);
		db.close();
	});
});

describe('openOwnedOfflineDB', () => {
	it('returns null when no user is known (nobody is or was logged in here)', async () => {
		const db = await openOfflineDB();
		await setOfflineOwner(db, 7);
		await upsertNote(db, makeNote(1));
		db.close();

		expect(await openOwnedOfflineDB(null)).toBeNull();
	});

	it('returns null when the store belongs to a different user', async () => {
		const db = await openOfflineDB();
		await setOfflineOwner(db, 7);
		await upsertNote(db, makeNote(1));
		db.close();

		expect(await openOwnedOfflineDB(8)).toBeNull();
	});

	it('returns null for an unowned store rather than adopting it', async () => {
		const db = await openOfflineDB();
		await upsertNote(db, makeNote(1));
		db.close();

		expect(await openOwnedOfflineDB(7)).toBeNull();
	});

	it('returns an open handle when the store belongs to the given user', async () => {
		const db = await openOfflineDB();
		await setOfflineOwner(db, 7);
		await upsertNote(db, makeNote(1));
		db.close();

		const owned = await openOwnedOfflineDB(7);
		expect(owned).not.toBeNull();
		expect((await getAllNotes(owned!)).map((n) => n.id)).toEqual([1]);
		owned!.close();
	});

	it('does not leave the refused connection open (a later delete is not blocked)', async () => {
		let db = await openOfflineDB();
		await setOfflineOwner(db, 7);
		db.close();

		expect(await openOwnedOfflineDB(8)).toBeNull();

		// deleteOfflineDB resolves on `blocked` too, so prove the store really
		// went away rather than trusting the promise.
		await deleteOfflineDB();
		db = await openOfflineDB();
		expect(await getOfflineOwner(db)).toBeNull();
		db.close();
	});
});

describe('requireOwnedOfflineDB', () => {
	it('throws OfflineOwnershipError when the store belongs to a different user', async () => {
		const db = await openOfflineDB();
		await setOfflineOwner(db, 7);
		db.close();

		await expect(requireOwnedOfflineDB(8)).rejects.toBeInstanceOf(OfflineOwnershipError);
	});

	it('returns an open handle when the store belongs to the given user', async () => {
		const db = await openOfflineDB();
		await setOfflineOwner(db, 7);
		await upsertNote(db, makeNote(1));
		db.close();

		const owned = await requireOwnedOfflineDB(7);
		expect((await getAllNotes(owned)).map((n) => n.id)).toEqual([1]);
		owned.close();
	});
});
