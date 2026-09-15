import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { openOfflineDB, upsertNote, updateCachedNote, getNote, deleteNote, type CachedNote } from './offlineDB';
import { acknowledgeCachedSave, acknowledgeCachedPrivacy, cacheSavedNote, cacheLearnedPrivacy, mergeSavedFlag, latestTimestamp, SaveRequests } from './noteSave';

const t0 = '2026-09-15T10:00:00.000000001Z';
const t1 = '2026-09-15T10:00:00.000000002Z';
const t2 = '2026-09-15T10:00:00.000000003Z';
const cached = (overrides: Partial<CachedNote> = {}): CachedNote => ({
	id: 1, title: 'Original', body: 'Body', starred: false, pinned: false, tags: [],
	server_updated_at: t0, local_updated_at: t0, is_dirty: false, is_new: false,
	...overrides,
});
const response = (title = 'Saved online', body = 'Body', updated_at = t2) => ({ id: 1, title, body, updated_at });

describe('content save acknowledgements', () => {
	it('round-trips out-of-order acknowledgements atomically and keeps the checkpoint for the next offline edit', async () => {
		const db = await openOfflineDB();
		const other = await openOfflineDB();
		try {
			await upsertNote(db, cached());
			await Promise.all([
				updateCachedNote(db, 1, (current) => acknowledgeCachedSave(current, 'title', response('Saved title', 'Saved body', t2))),
				updateCachedNote(other, 1, (current) => acknowledgeCachedSave(current, 'body', response('Original', 'Saved body', t1))),
			]);
			expect(await getNote(db, 1)).toMatchObject({ title: 'Saved title', body: 'Saved body', is_dirty: false,
				server_updated_at: t2, local_updated_at: t2 });
			await updateCachedNote(other, 1, (current) => ({ ...current!, title: 'Next offline edit', is_dirty: true }));
			// Sync compares this exact checkpoint with the current server version.
			expect((await getNote(db, 1))?.server_updated_at).toBe(t2);
		} finally {
			await deleteNote(db, 1);
			db.close();
			other.close();
		}
	});

	it('replaces an earlier dirty title with the later successful title and clears acknowledged content dirtiness', () => {
		const result = acknowledgeCachedSave(cached({ title: 'Failed earlier save', is_dirty: true }), 'title', response());
		expect(result).toEqual(cached({ title: 'Saved online', server_updated_at: t2, local_updated_at: t2 }));
	});

	it('preserves unsynced body edits, local edit time, and queued actions when acknowledging the title', () => {
		const original = cached({ title: 'Failed earlier save', body: 'Offline body', is_dirty: true,
			local_updated_at: t1, flags_dirty: true, flags_toggled: { pinned: true }, pinned: true, archived_offline: true });
		expect(acknowledgeCachedSave(original, 'title', response())).toEqual({
			...original, title: 'Saved online', // sibling remains based on the original checkpoint
		});
	});

	it('does not roll back the sync checkpoint or clean local timestamp on a late body response', () => {
		const original = cached({ title: 'Saved online', server_updated_at: t2, local_updated_at: t2 });
		expect(acknowledgeCachedSave(original, 'body', response('Original', 'Saved body', t1))).toEqual({
			...original, body: 'Saved body',
		});
	});

	it('keeps a newer offline title dirty when an older body response arrives', () => {
		const original = cached({ title: 'Offline title', is_dirty: true, server_updated_at: t2, local_updated_at: t2 });
		expect(acknowledgeCachedSave(original, 'body', response('Original', 'Saved body', t1))).toEqual({
			...original, body: 'Saved body',
		});
	});

	it('does not acknowledge a newer same-field offline edit on behalf of an older request', () => {
		const requests = new SaveRequests();
		const older = requests.begin(1, 'body');
		const newer = requests.begin(1, 'body');
		const original = cached({ body: 'New offline body', is_dirty: true, local_updated_at: t2 });
		expect(older()).toBe(false);
		expect(newer()).toBe(true);
		expect(acknowledgeCachedSave(original, 'body', response('Original', 'Old body', t1), older())).toEqual({
			...original, // the newer offline edit has not acknowledged this server version
		});
	});

	it('tracks request order independently per note and field', () => {
		const requests = new SaveRequests();
		const body = requests.begin(1, 'body');
		requests.begin(1, 'title');
		requests.begin(2, 'body');
		expect(body()).toBe(true);
	});
});

describe('flag response acknowledgements', () => {
	const current = { id: 1, title: 'New title', body: 'New body', private: true,
		starred: false, pinned: false, locked: false, pin_order: 0, archived: false,
		created_at: t0, updated_at: t2 };
	const stale = { ...current, title: 'Old title', body: 'Old body', private: false,
		starred: true, pinned: true, locked: true, pin_order: -3, updated_at: t0 };
	it.each(['starred', 'pinned', 'locked'] as const)('acknowledges only %s without rolling back content or privacy', (flag) => {
		expect(mergeSavedFlag(current, stale, flag)).toEqual({
			...current, [flag]: true, ...(flag === 'pinned' ? { pin_order: -3 } : {}),
		});
	});
	it.each(['starred', 'pinned', 'locked'] as const)('applies the explicit privacy guard to a late %s response', (flag) => {
		const requests = new SaveRequests();
		const acceptPrivacy = requests.guardPrivacy(1);
		requests.privacyChanged(1);
		expect(mergeSavedFlag({ ...current, private: false }, { ...stale, private: true }, flag, acceptPrivacy()).private).toBe(false);
	});
	it.each(['starred', 'pinned', 'locked'] as const)('learns private=true from a current %s response', (flag) => {
		expect(mergeSavedFlag({ ...current, private: false }, { ...stale, private: true }, flag).private).toBe(true);
	});
	it('persists learned privacy without acknowledging cached content or flag work', async () => {
		const db = await openOfflineDB();
		try {
			const original = cached({ private: false, is_dirty: true, body: 'Offline body',
				flags_dirty: true, flags_toggled: { starred: true }, starred: true });
			await upsertNote(db, original);
			expect(await cacheLearnedPrivacy(openOfflineDB, { ...stale, private: true }, () => true)).toBe(true);
			expect(await getNote(db, 1)).toEqual({ ...original, private: true });
			await updateCachedNote(db, 1, (note) => ({ ...note!, private: false }));
			expect(await cacheLearnedPrivacy(openOfflineDB, { ...stale, private: true }, () => false)).toBe(true);
			expect(await getNote(db, 1)).toMatchObject({ private: false });
		} finally { await deleteNote(db, 1); db.close(); }
	});
});

describe('privacy learned from content responses', () => {
	it.each(['title', 'body'] as const)('learns private=true from a %s response while retaining a dirty sibling', (field) => {
		const sibling = field === 'title' ? 'body' : 'title';
		const original = cached({ private: false, is_dirty: true, [sibling]: 'Unsynced private content',
			flags_dirty: true, flags_toggled: { pinned: true } });
		const result = acknowledgeCachedSave(original, field, { ...response(), private: true });
		expect(result).toMatchObject({ private: true, is_dirty: true, [sibling]: 'Unsynced private content',
			server_updated_at: t0, flags_dirty: true, flags_toggled: { pinned: true } });
	});
	it('learns privacy even when a newer same-field edit superseded the saved content', () => {
		const original = cached({ private: false, body: 'Newer offline body', is_dirty: true });
		expect(acknowledgeCachedSave(original, 'body', { ...response(), private: true }, false))
			.toEqual({ ...original, private: true });
	});
	it('does not declassify local content on an older public response', () => {
		expect(acknowledgeCachedSave(cached({ private: true }), 'title', { ...response(), private: false }).private).toBe(true);
	});
	it('invalidates earlier privacy inferences only on an explicit write to that note', () => {
		const requests = new SaveRequests();
		const title = requests.guardPrivacy(1);
		const body = requests.guardPrivacy(1);
		requests.begin(1, 'body');
		requests.privacyChanged(2);
		expect(title()).toBe(true);
		expect(body()).toBe(true);
		requests.privacyChanged(1);
		expect(title()).toBe(false);
		expect(body()).toBe(false);
		expect(requests.guardPrivacy(1)()).toBe(true);
	});
	it('honors an explicit clear from a different editor instance after navigation', () => {
		const previousEditor = new SaveRequests();
		const acceptPrivacy = previousEditor.guardPrivacy(1);
		const nextEditor = new SaveRequests();
		nextEditor.privacyChanged(1);
		expect(acceptPrivacy()).toBe(false);
	});
	it('checks the privacy guard again when the cache transaction finally starts', async () => {
		const db = await openOfflineDB();
		try {
			await upsertNote(db, cached({ private: true }));
			const requests = new SaveRequests();
			const acceptPrivacy = requests.guardPrivacy(1);
			let release!: (db: IDBDatabase) => void;
			const opened = new Promise<IDBDatabase>((resolve) => { release = resolve; });
			const pending = cacheSavedNote(() => opened, 'body', { ...response('Original'), private: true }, () => true, [], acceptPrivacy);
			requests.privacyChanged(1);
			await updateCachedNote(db, 1, (current) => acknowledgeCachedPrivacy(current, { ...response('Original'), private: false }));
			release(await openOfflineDB());
			expect(await pending).toBe(true);
			expect(await getNote(db, 1)).toMatchObject({ private: false });
		} finally { await deleteNote(db, 1); db.close(); }
	});
});

describe('explicit privacy acknowledgements', () => {
	it.each([false, true])('persists private=%s while retaining all unrelated dirty state', (value) => {
		const original = cached({ private: !value, body: 'Offline body', is_dirty: true,
			flags_dirty: true, flags_toggled: { pinned: true }, pinned: true, pin_order: -3,
			archived_offline: true, local_updated_at: t1 });
		expect(acknowledgeCachedPrivacy(original, { ...response(), private: value })).toEqual({
			...original, private: value,
		});
	});
	it('advances only an accounted-for content baseline', () => {
		expect(acknowledgeCachedPrivacy(cached({ private: true }), { ...response('Original'), private: false }))
			.toEqual(cached({ private: false, server_updated_at: t2, local_updated_at: t2 }));
	});
	it('creates a missing cache row with the acknowledged privacy', () => {
		expect(acknowledgeCachedPrivacy(null, { ...response(), private: true }))
			.toMatchObject({ id: 1, private: true, title: 'Saved online', body: 'Body', is_dirty: false });
	});
	it('atomically preserves a concurrent offline edit during explicit clearing', async () => {
		const db = await openOfflineDB();
		try {
			await upsertNote(db, cached({ private: true }));
			await Promise.all([
				updateCachedNote(db, 1, (current) => ({ ...current!, body: 'Offline body', is_dirty: true })),
				cacheSavedNote(openOfflineDB, 'private', { ...response('Original'), private: false }, () => true),
			]);
			expect(await getNote(db, 1)).toMatchObject({ body: 'Offline body', is_dirty: true, private: false,
				server_updated_at: t0 });
		} finally { await deleteNote(db, 1); db.close(); }
	});
});

describe('best-effort cache acknowledgement after server success', () => {
	it.each(['title', 'private'] as const)('reports cache-open failure without rejecting the successful %s save', async (field) => {
		await expect(cacheSavedNote(async () => { throw new Error('unavailable'); }, field, response(), () => true)).resolves.toBe(false);
	});

	it.each(['title', 'private'] as const)('does not reject on %s transaction failure', async (field) => {
		const db = await openOfflineDB();
		db.close();
		await expect(cacheSavedNote(async () => db, field, response(), () => true)).resolves.toBe(false);
	});

	it.each(['title', 'private'] as const)('does not access a cache the ownership gate refused for %s', async (field) => {
		await expect(cacheSavedNote(async () => null, field, response(), () => true)).resolves.toBe(false);
	});

	it('still acknowledges a successful write using a real transaction', async () => {
		await expect(cacheSavedNote(openOfflineDB, 'title', response(), () => true)).resolves.toBe(true);
		const db = await openOfflineDB();
		try {
			expect(await getNote(db, 1)).toMatchObject({ title: 'Saved online', is_dirty: false });
			await deleteNote(db, 1);
		} finally { db.close(); }
	});
});

describe('latestTimestamp', () => {
	it('compares nanoseconds rather than truncating Go timestamps to JS milliseconds', () => {
		expect(latestTimestamp(t2, t1)).toBe(t2);
		expect(latestTimestamp(t1, t2)).toBe(t2);
	});
	it('compares instants across timezone offsets and fractional precision', () => {
		expect(latestTimestamp('2026-09-15T11:00:00+02:00', t0)).toBe(t0);
		expect(latestTimestamp('2026-09-15T10:00:00.1Z', '2026-09-15T10:00:00.09Z')).toBe('2026-09-15T10:00:00.1Z');
	});
});
