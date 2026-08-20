import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { markNoteDeletedOffline, markNoteArchivedOffline } from './offlineActions';
import { openOfflineDB, getNote, upsertNote, deleteOfflineDB } from './offlineDB';
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

beforeEach(async () => {
	await deleteOfflineDB();
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

		await markNoteDeletedOffline(serverNote());

		const check = await openOfflineDB();
		const cached = await getNote(check, 10);
		check.close();
		expect(cached?.deleted_offline).toBe(true);
		expect(cached?.is_dirty).toBe(true);
		expect(cached?.title).toBe('Cached'); // existing cache entry preserved
	});

	it('creates a cache entry for an uncached note so the delete still replays', async () => {
		await markNoteDeletedOffline(serverNote({ id: 11, title: 'Uncached' }));

		const db = await openOfflineDB();
		const cached = await getNote(db, 11);
		db.close();
		expect(cached?.deleted_offline).toBe(true);
		expect(cached?.is_dirty).toBe(true);
	});

	it('discards an offline-created note entirely (nothing to replay)', async () => {
		const db = await openOfflineDB();
		await upsertNote(db, {
			id: -99, title: 'Temp', body: '', starred: false, pinned: false, tags: [],
			server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-01T00:00:00Z',
			is_dirty: true, is_new: true,
		});
		db.close();

		await markNoteDeletedOffline(serverNote({ id: -99 }));

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

		await markNoteArchivedOffline(serverNote());

		const check = await openOfflineDB();
		const cached = await getNote(check, 10);
		check.close();
		expect(cached?.archived_offline).toBe(true);
		expect(cached?.title).toBe('Edited offline');
	});

	it('keeps is_new on an offline-created note so sync creates it before archiving', async () => {
		const db = await openOfflineDB();
		await upsertNote(db, {
			id: -50, title: 'Temp', body: 'B', starred: false, pinned: false, tags: [],
			server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-01T00:00:00Z',
			is_dirty: true, is_new: true,
		});
		db.close();

		await markNoteArchivedOffline(serverNote({ id: -50 }));

		const check = await openOfflineDB();
		const cached = await getNote(check, -50);
		check.close();
		expect(cached?.archived_offline).toBe(true);
		expect(cached?.is_new).toBe(true);
	});
});
