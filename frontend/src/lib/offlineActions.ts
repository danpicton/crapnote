import { openOfflineDB, getNote, upsertNote, deleteNote } from '$lib/offlineDB';
import type { CachedNote } from '$lib/offlineDB';
import type { Note } from '$lib/api';

/**
 * Optimistic offline note actions. When a delete/archive can't reach the
 * server, the action is recorded on the note's IndexedDB entry
 * (`deleted_offline` / `archived_offline` + `is_dirty`) so the UI can apply
 * it immediately and `syncOfflineChanges` replays it against the API on
 * reconnect.
 */

function cachedFromNote(note: Note, tags: Array<{ id: number; name: string }>): CachedNote {
	return {
		id: note.id,
		title: note.title,
		body: note.body,
		starred: note.starred,
		pinned: note.pinned,
		locked: note.locked,
		tags,
		server_updated_at: note.updated_at,
		local_updated_at: new Date().toISOString(),
		is_dirty: true,
		is_new: note.id < 0,
	};
}

/**
 * Queue a delete for replay. A note created offline that never reached the
 * server (negative temp id / is_new) is simply discarded — there is nothing
 * to replay.
 */
export async function markNoteDeletedOffline(
	note: Note,
	tags: Array<{ id: number; name: string }> = []
): Promise<void> {
	const db = await openOfflineDB();
	try {
		const existing = await getNote(db, note.id);
		if (existing?.is_new || note.id < 0) {
			await deleteNote(db, note.id);
			return;
		}
		await upsertNote(db, {
			...(existing ?? cachedFromNote(note, tags)),
			is_dirty: true,
			deleted_offline: true,
			local_updated_at: new Date().toISOString(),
		});
	} finally {
		db.close();
	}
}

/** Queue an archive for replay. Offline-created notes keep their `is_new`
 * flag so sync knows to create them server-side before archiving. */
export async function markNoteArchivedOffline(
	note: Note,
	tags: Array<{ id: number; name: string }> = []
): Promise<void> {
	const db = await openOfflineDB();
	try {
		const existing = await getNote(db, note.id);
		await upsertNote(db, {
			...(existing ?? cachedFromNote(note, tags)),
			is_dirty: true,
			archived_offline: true,
			local_updated_at: new Date().toISOString(),
		});
	} finally {
		db.close();
	}
}
