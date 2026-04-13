import { api } from '$lib/api';
import { openOfflineDB, getDirtyNotes, upsertNote, deleteNote } from '$lib/offlineDB';
import type { CachedNote } from '$lib/offlineDB';

export interface IdMapping {
	tempId: number;
	serverId: number;
}

// Module-level mutex: prevents two concurrent sync runs from racing each other.
// The second caller gets back an empty mapping immediately.
let syncInProgress = false;

/**
 * Sync all dirty cached notes back to the server.
 * Returns the list of temp-ID → server-ID mappings for notes that were created offline,
 * so callers can update any in-progress navigation.
 */
export async function syncOfflineChanges(): Promise<IdMapping[]> {
	if (syncInProgress) return [];
	syncInProgress = true;

	const db = await openOfflineDB();
	const dirty = await getDirtyNotes(db);
	const mappings: IdMapping[] = [];

	try {
		for (const note of dirty) {
			try {
				if (note.is_new) {
					await syncNewNote(db, note, mappings);
				} else {
					await syncDirtyNote(db, note);
				}
			} catch {
				// Network error for this note — skip and continue with others
			}
		}
	} finally {
		db.close();
		syncInProgress = false;
	}

	return mappings;
}

async function syncNewNote(db: IDBDatabase, note: CachedNote, mappings: IdMapping[]): Promise<void> {
	const serverNote = await api.notes.create(note.title, note.body);
	await deleteNote(db, note.id);
	await upsertNote(db, {
		id: serverNote.id,
		title: serverNote.title,
		body: serverNote.body,
		starred: serverNote.starred,
		pinned: serverNote.pinned,
		tags: note.tags, // preserve any tags the user added offline
		server_updated_at: serverNote.updated_at,
		local_updated_at: serverNote.updated_at,
		is_dirty: false,
		is_new: false,
	});
	mappings.push({ tempId: note.id, serverId: serverNote.id });
}

async function syncDirtyNote(db: IDBDatabase, note: CachedNote): Promise<void> {
	const serverNote = await api.notes.get(note.id);

	if (serverNote.updated_at === note.server_updated_at) {
		// No server-side change since we last synced — our version wins
		const updated = await api.notes.update(note.id, { title: note.title, body: note.body });
		await upsertNote(db, {
			...note,
			title: updated.title,
			body: updated.body,
			server_updated_at: updated.updated_at,
			local_updated_at: updated.updated_at,
			is_dirty: false,
		});
	} else {
		// Conflict: server also changed — save our version as a new conflict note
		await api.notes.create(`[sync conflict] ${note.title}`, note.body);
		// Store the server version locally (tags from server aren't cached here;
		// they'll be refreshed on the next online load)
		await upsertNote(db, {
			id: serverNote.id,
			title: serverNote.title,
			body: serverNote.body,
			starred: serverNote.starred,
			pinned: serverNote.pinned,
			tags: note.tags,
			server_updated_at: serverNote.updated_at,
			local_updated_at: serverNote.updated_at,
			is_dirty: false,
			is_new: false,
		});
	}
}
