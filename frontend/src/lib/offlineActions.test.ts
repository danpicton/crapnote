import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { markNoteDeletedOffline, markNoteArchivedOffline, markNoteFlagsOffline } from './offlineActions';
import { openOfflineDB, getNote, upsertNote, deleteOfflineDB, setOfflineOwner } from './offlineDB';
import { OfflineOwnershipError } from './localData';
import type { Note } from './api';

const serverNote = (overrides: Partial<Note> = {}): Note => ({
	id: 10,
	title: 'T',
	body: 'B',
	starred: false,
	pinned: false,
	archived: false,
	locked: false,
	created_at: '2024-01-01T00:00:00Z',
	updated_at: '2024-01-01T00:00:00Z',
	...overrides,
});

// The signed-in user in these tests; the store is stamped as theirs unless a
// test re-stamps it to prove the ownership guard bites.
const OWNER = 7;

beforeEach(async () => {
	await deleteOfflineDB();
	const db = await openOfflineDB();
	await setOfflineOwner(db, OWNER);
	db.close();
});

describe('markNoteDeletedOffline', () => {
	it('flags an already-cached server note for delete replay', async () => {
		const db = await openOfflineDB();
		await upsertNote(db, {
			id: 10, title: 'Cached', body: 'Body', starred: false, pinned: false, tags: [],
			server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-01T00:00:00Z',
			is_dirty: false, is_new: false,
		});
		db.close();

		await markNoteDeletedOffline(OWNER, serverNote());

		const check = await openOfflineDB();
		const cached = await getNote(check, 10);
		check.close();
		expect(cached?.deleted_offline).toBe(true);
		// is_dirty tracks content edits only — a delete is not a content edit
		expect(cached?.is_dirty).toBe(false);
		expect(cached?.title).toBe('Cached'); // existing cache entry preserved
	});

	it('creates a cache entry for an uncached note so the delete still replays', async () => {
		await markNoteDeletedOffline(OWNER, serverNote({ id: 11, title: 'Uncached' }));

		const db = await openOfflineDB();
		const cached = await getNote(db, 11);
		db.close();
		expect(cached?.deleted_offline).toBe(true);
		expect(cached?.is_dirty).toBe(false);
	});

	it('discards an offline-created note entirely (nothing to replay)', async () => {
		const db = await openOfflineDB();
		await upsertNote(db, {
			id: -99, title: 'Temp', body: '', starred: false, pinned: false, tags: [],
			server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-01T00:00:00Z',
			is_dirty: true, is_new: true,
		});
		db.close();

		await markNoteDeletedOffline(OWNER, serverNote({ id: -99 }));

		const check = await openOfflineDB();
		expect(await getNote(check, -99)).toBeNull();
		check.close();
	});
});

describe('markNoteArchivedOffline', () => {
	it('flags a server note for archive replay, keeping local edits', async () => {
		const db = await openOfflineDB();
		await upsertNote(db, {
			id: 10, title: 'Edited offline', body: 'New body', starred: false, pinned: false, tags: [],
			server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-02T00:00:00Z',
			is_dirty: true, is_new: false,
		});
		db.close();

		await markNoteArchivedOffline(OWNER, serverNote());

		const check = await openOfflineDB();
		const cached = await getNote(check, 10);
		check.close();
		expect(cached?.archived_offline).toBe(true);
		expect(cached?.title).toBe('Edited offline');
		// The pre-existing content edit stays dirty so replay pushes it
		expect(cached?.is_dirty).toBe(true);
	});

	it('an archive with no content edits stays clean so replay skips the content push', async () => {
		await markNoteArchivedOffline(OWNER, serverNote({ id: 12 }));

		const check = await openOfflineDB();
		const cached = await getNote(check, 12);
		check.close();
		expect(cached?.archived_offline).toBe(true);
		expect(cached?.is_dirty).toBe(false);
	});

	it('keeps is_new on an offline-created note so sync creates it before archiving', async () => {
		const db = await openOfflineDB();
		await upsertNote(db, {
			id: -50, title: 'Temp', body: 'B', starred: false, pinned: false, tags: [],
			server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-01T00:00:00Z',
			is_dirty: true, is_new: true,
		});
		db.close();

		await markNoteArchivedOffline(OWNER, serverNote({ id: -50 }));

		const check = await openOfflineDB();
		const cached = await getNote(check, -50);
		check.close();
		expect(cached?.archived_offline).toBe(true);
		expect(cached?.is_new).toBe(true);
	});
});

describe('markNoteFlagsOffline', () => {
	it('records the desired flag state and marks flags_dirty, preserving content state', async () => {
		const db = await openOfflineDB();
		await upsertNote(db, {
			id: 10, title: 'T', body: 'B', starred: false, pinned: false, locked: true, tags: [],
			server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-01T00:00:00Z',
			is_dirty: false, is_new: false,
		});
		db.close();

		await markNoteFlagsOffline(OWNER, serverNote({ id: 10, locked: false, starred: true }), 'locked');
		await markNoteFlagsOffline(OWNER, serverNote({ id: 10, locked: false, starred: true }), 'starred');

		const check = await openOfflineDB();
		const cached = await getNote(check, 10);
		check.close();
		expect(cached?.locked).toBe(false);
		expect(cached?.starred).toBe(true);
		expect(cached?.flags_dirty).toBe(true);
		expect(cached?.flags_toggled).toEqual({ locked: true, starred: true });
		expect(cached?.is_dirty).toBe(false); // content untouched
		expect(cached?.title).toBe('T');
	});

	it('creates a cache entry for an uncached note so the toggle still syncs', async () => {
		await markNoteFlagsOffline(OWNER, serverNote({ id: 21, locked: false }), 'locked');

		const check = await openOfflineDB();
		const cached = await getNote(check, 21);
		check.close();
		expect(cached?.flags_dirty).toBe(true);
		expect(cached?.locked).toBe(false);
	});
});

describe('ownership guard', () => {
	async function stampOtherOwner() {
		const db = await openOfflineDB();
		await setOfflineOwner(db, OWNER + 1);
		await upsertNote(db, {
			id: 10, title: 'Theirs', body: 'Theirs', starred: false, pinned: false, tags: [],
			server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-01T00:00:00Z',
			is_dirty: false, is_new: false,
		});
		db.close();
	}

	async function cached(id: number) {
		const db = await openOfflineDB();
		const note = await getNote(db, id);
		db.close();
		return note;
	}

	it('refuses a flag toggle into another user\'s store, writing nothing', async () => {
		await stampOtherOwner();

		await expect(markNoteFlagsOffline(OWNER, serverNote({ starred: true }), 'starred'))
			.rejects.toBeInstanceOf(OfflineOwnershipError);

		expect((await cached(10))?.flags_dirty).toBeUndefined();
	});

	it('refuses an archive into another user\'s store, writing nothing', async () => {
		await stampOtherOwner();

		await expect(markNoteArchivedOffline(OWNER, serverNote()))
			.rejects.toBeInstanceOf(OfflineOwnershipError);

		expect((await cached(10))?.archived_offline).toBeUndefined();
	});

	it('refuses a delete into another user\'s store, leaving the entry alone', async () => {
		await stampOtherOwner();

		await expect(markNoteDeletedOffline(OWNER, serverNote()))
			.rejects.toBeInstanceOf(OfflineOwnershipError);

		expect((await cached(10))?.deleted_offline).toBeUndefined();
	});
});
