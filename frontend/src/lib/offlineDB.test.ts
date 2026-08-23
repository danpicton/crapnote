import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { openOfflineDB, upsertNote, getNote, getAllNotes, getDirtyNotes, deleteNote, noteFlags } from './offlineDB';

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

describe('noteFlags', () => {
	const full = { starred: true, pinned: true, locked: true, pin_order: -3 };

	it('takes every field from the source', () => {
		expect(noteFlags(full)).toEqual(full);
	});

	it('falls back per field for whatever the source omits', () => {
		expect(noteFlags({ starred: true }, { pinned: true, locked: true, pin_order: -9 })).toEqual({
			starred: true,
			pinned: true,
			locked: true,
			pin_order: -9,
		});
	});

	it('keeps a deliberate false rather than reaching for the fallback', () => {
		// The bug this guards: a note explicitly unlocked offline must not have
		// a cached `locked: true` reinstated by the fallback.
		expect(noteFlags({ locked: false }, { locked: true }).locked).toBe(false);
		expect(noteFlags({ pin_order: 0 }, { pin_order: -5 }).pin_order).toBe(0);
	});

	it('defaults to unset when neither side supplies a value', () => {
		expect(noteFlags({})).toEqual({
			starred: false,
			pinned: false,
			locked: false,
			pin_order: 0,
		});
	});

	it('covers exactly the flag fields — the set that must travel together', () => {
		expect(Object.keys(noteFlags({})).sort()).toEqual([
			'locked',
			'pin_order',
			'pinned',
			'starred',
		]);
	});
});
