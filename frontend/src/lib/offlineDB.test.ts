import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { openOfflineDB, upsertNote, getNote, getAllNotes, getDirtyNotes, deleteNote } from './offlineDB';

const makeNote = (overrides: Partial<Parameters<typeof upsertNote>[1]> = {}) => ({
	title: 'Test',
	body: 'Body',
	starred: false,
	pinned: false,
	tags: [] as Array<{ id: number; name: string }>,
	server_updated_at: '2024-01-01T00:00:00Z',
	local_updated_at: '2024-01-01T00:00:00Z',
	is_dirty: false,
	is_new: false,
	...overrides,
});

describe('offlineDB', () => {
	it('upserts a note and retrieves it by id', async () => {
		const db = await openOfflineDB();
		await upsertNote(db, { id: 1, ...makeNote({ title: 'Hello' }) });
		const note = await getNote(db, 1);
		expect(note).not.toBeNull();
		expect(note!.title).toBe('Hello');
		expect(note!.id).toBe(1);
		db.close();
	});

	it('stores and retrieves tags with a note', async () => {
		const db = await openOfflineDB();
		await upsertNote(db, { id: 2, ...makeNote({ tags: [{ id: 5, name: 'work' }] }) });
		const note = await getNote(db, 2);
		expect(note!.tags).toEqual([{ id: 5, name: 'work' }]);
		db.close();
	});

	it('returns null for a note that does not exist', async () => {
		const db = await openOfflineDB();
		const note = await getNote(db, 9999);
		expect(note).toBeNull();
		db.close();
	});

	it('getAllNotes returns all upserted notes', async () => {
		const db = await openOfflineDB();
		await upsertNote(db, { id: 10, ...makeNote({ title: 'A' }) });
		await upsertNote(db, { id: 11, ...makeNote({ title: 'B' }) });
		const notes = await getAllNotes(db);
		const ids = notes.map(n => n.id);
		expect(ids).toContain(10);
		expect(ids).toContain(11);
		db.close();
	});

	it('getDirtyNotes returns only notes with is_dirty=true', async () => {
		const db = await openOfflineDB();
		await upsertNote(db, { id: 20, ...makeNote({ is_dirty: false }) });
		await upsertNote(db, { id: 21, ...makeNote({ is_dirty: true, is_new: false }) });
		await upsertNote(db, { id: 22, ...makeNote({ is_dirty: true, is_new: true }) });
		const dirty = await getDirtyNotes(db);
		expect(dirty.map(n => n.id).sort()).toEqual([21, 22]);
		db.close();
	});

	it('upsert overwrites an existing note by id', async () => {
		const db = await openOfflineDB();
		await upsertNote(db, { id: 30, ...makeNote({ title: 'Original' }) });
		await upsertNote(db, { id: 30, ...makeNote({ title: 'Updated', is_dirty: true }) });
		const note = await getNote(db, 30);
		expect(note!.title).toBe('Updated');
		expect(note!.is_dirty).toBe(true);
		db.close();
	});

	it('deleteNote removes a note by id', async () => {
		const db = await openOfflineDB();
		await upsertNote(db, { id: 40, ...makeNote() });
		await deleteNote(db, 40);
		const note = await getNote(db, 40);
		expect(note).toBeNull();
		db.close();
	});
});
