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
		// Mirrors the in-memory note as-is: no content edit has happened, so
		// the sync replay knows it may skip the title/body push entirely.
		is_dirty: false,
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
		// is_dirty is left as-is: it tracks content edits only, and a delete
		// doesn't need (or want) a title/body push during replay.
		await upsertNote(db, {
			...(existing ?? cachedFromNote(note, tags)),
			deleted_offline: true,
			local_updated_at: new Date().toISOString(),
		});
	} finally {
		db.close();
	}
}

/**
 * Record the user's desired starred/pinned/locked state after an offline
 * toggle. `note` carries the already-toggled values; sync reconciles them
 * against the server with compare-and-toggle (see offlineSync).
 */
export async function markNoteFlagsOffline(
	note: Note,
	tags: Array<{ id: number; name: string }> = []
): Promise<void> {
	const db = await openOfflineDB();
	try {
		const existing = await getNote(db, note.id);
		await upsertNote(db, {
			...(existing ?? cachedFromNote(note, tags)),
			starred: note.starred,
			pinned: note.pinned,
			locked: note.locked,
			flags_dirty: true,
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
		// is_dirty is left as-is: an archive with no content edits must not
		// push the (possibly stale) cached title/body over newer server-side
		// edits during replay.
		await upsertNote(db, {
			...(existing ?? cachedFromNote(note, tags)),
			archived_offline: true,
			local_updated_at: new Date().toISOString(),
		});
	} finally {
		db.close();
	}
}
