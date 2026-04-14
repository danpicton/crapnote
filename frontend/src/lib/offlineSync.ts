import { api } from '$lib/api';
import { openOfflineDB, getDirtyNotes, upsertNote, deleteNote } from '$lib/offlineDB';
import type { CachedNote } from '$lib/offlineDB';

export interface IdMapping {
	tempId: number;
	serverId: number;
}

export type SyncTrigger = 'heartbeat' | 'online' | 'manual' | 'mount';

export interface SyncResult {
	trigger: SyncTrigger;
	startedAt: string;
	durationMs: number;
	mappings: IdMapping[];
	/** Dirty notes successfully pushed to the server. */
	pushed: { created: number; updated: number };
	/** Notes where both sides changed since our last sync. */
	conflicts: number;
	/** Notes whose push attempt threw (network error, server error). */
	errors: number;
	/** True if this call was a no-op because another sync was already running. */
	skipped: boolean;
}

// Module-level mutex: prevents two concurrent sync runs from racing each other.
let syncInProgress = false;

/**
 * Push all locally-dirty notes to the server and return a structured result
 * the caller can use to update its UI (e.g. remap temp IDs, update a
 * "last synced" indicator, show conflict count, etc).
 *
 * Every run logs a one-line summary to `console.info` so the sync trail is
 * visible in DevTools without needing a dedicated status view.
 *
 * The caller is expected to trigger a list-reload after this returns so
 * server-side changes made elsewhere become visible locally (see
 * `heartbeatSync` in `+page.svelte`).
 */
export async function syncOfflineChanges(trigger: SyncTrigger = 'heartbeat'): Promise<SyncResult> {
	const startedAt = new Date().toISOString();
	const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
	const result: SyncResult = {
		trigger,
		startedAt,
		durationMs: 0,
		mappings: [],
		pushed: { created: 0, updated: 0 },
		conflicts: 0,
		errors: 0,
		skipped: false,
	};

	if (syncInProgress) {
		result.skipped = true;
		result.durationMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start);
		logSyncResult(result);
		return result;
	}
	syncInProgress = true;

	const db = await openOfflineDB();
	try {
		const dirty = await getDirtyNotes(db);
		for (const note of dirty) {
			try {
				if (note.is_new) {
					await syncNewNote(db, note, result);
				} else {
					await syncDirtyNote(db, note, result);
				}
			} catch {
				// Network error for this note — count it and continue
				result.errors++;
			}
		}
	} finally {
		db.close();
		syncInProgress = false;
	}

	result.durationMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start);
	logSyncResult(result);
	return result;
}

function logSyncResult(r: SyncResult): void {
	// Single structured line so filtering by "[sync]" in DevTools surfaces the
	// whole history. Includes trigger, outcome counts, and duration.
	console.info('[sync]', {
		trigger: r.trigger,
		startedAt: r.startedAt,
		durationMs: r.durationMs,
		created: r.pushed.created,
		updated: r.pushed.updated,
		conflicts: r.conflicts,
		errors: r.errors,
		skipped: r.skipped,
		mappings: r.mappings.length,
	});
}

async function syncNewNote(db: IDBDatabase, note: CachedNote, result: SyncResult): Promise<void> {
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
	result.mappings.push({ tempId: note.id, serverId: serverNote.id });
	result.pushed.created++;
}

async function syncDirtyNote(db: IDBDatabase, note: CachedNote, result: SyncResult): Promise<void> {
	const serverNote = await api.notes.get(note.id);

	if (serverNote.updated_at === note.server_updated_at) {
		// No server-side change since we last synced — our version wins cleanly
		const updated = await api.notes.update(note.id, { title: note.title, body: note.body });
		await upsertNote(db, {
			...note,
			title: updated.title,
			body: updated.body,
			server_updated_at: updated.updated_at,
			local_updated_at: updated.updated_at,
			is_dirty: false,
		});
		result.pushed.updated++;
		return;
	}

	// Conflict: both sides changed since our last sync.
	// Winner is whichever was edited most recently; loser is preserved as a
	// new note prefixed with "[sync conflict]" so the user can reconcile manually.
	result.conflicts++;
	const localWins = new Date(note.local_updated_at).getTime() > new Date(serverNote.updated_at).getTime();

	if (localWins) {
		// Preserve the server's version as the conflict note, then push local.
		await api.notes.create(`[sync conflict] ${serverNote.title}`, serverNote.body);
		const updated = await api.notes.update(note.id, { title: note.title, body: note.body });
		await upsertNote(db, {
			...note,
			title: updated.title,
			body: updated.body,
			server_updated_at: updated.updated_at,
			local_updated_at: updated.updated_at,
			is_dirty: false,
		});
		result.pushed.updated++;
	} else {
		// Server wins. Preserve the local edit as a conflict note, then accept server.
		await api.notes.create(`[sync conflict] ${note.title}`, note.body);
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
