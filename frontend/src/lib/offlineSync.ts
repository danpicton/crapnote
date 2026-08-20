import { api } from '$lib/api';
import { openOfflineDB, getDirtyNotes, upsertNote, deleteNote, getOfflineOwner, setOfflineOwner } from '$lib/offlineDB';
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
	/** Dirty notes successfully pushed to the server. `deleted` and
	 * `archived` count offline deletes/archives replayed against the API. */
	pushed: { created: number; updated: number; deleted: number; archived: number };
	/** Notes where both sides changed since our last sync. */
	conflicts: number;
	/** Notes whose push attempt threw (network error, server error). */
	errors: number;
	/** True if this call was a no-op because another sync was already running,
	 * or because the offline store belongs to a different user than the
	 * current session (see `reason`). */
	skipped: boolean;
	/** Why the run was skipped, when it was. */
	reason?: 'in-progress' | 'no-user' | 'owner-mismatch';
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
 *
 * `currentUserId` is the id of the user the active session belongs to. Dirty
 * notes are only pushed when the offline store's recorded owner matches it —
 * on a shared browser, user A's offline edits must never be created inside
 * user B's account just because B logged in next.
 */
export async function syncOfflineChanges(
	trigger: SyncTrigger = 'heartbeat',
	currentUserId: number | null = null
): Promise<SyncResult> {
	const startedAt = new Date().toISOString();
	const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
	const result: SyncResult = {
		trigger,
		startedAt,
		durationMs: 0,
		mappings: [],
		pushed: { created: 0, updated: 0, deleted: 0, archived: 0 },
		conflicts: 0,
		errors: 0,
		skipped: false,
	};

	if (syncInProgress) {
		result.skipped = true;
		result.reason = 'in-progress';
		result.durationMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start);
		logSyncResult(result);
		return result;
	}
	if (currentUserId === null) {
		result.skipped = true;
		result.reason = 'no-user';
		result.durationMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start);
		logSyncResult(result);
		return result;
	}
	syncInProgress = true;

	const db = await openOfflineDB();
	try {
		const owner = (await getOfflineOwner(db)) ?? null;
		if (owner === null) {
			// Legacy store from before owner tracking — adopt it for the
			// current user rather than stranding pre-upgrade offline edits.
			await setOfflineOwner(db, currentUserId);
		} else if (owner !== currentUserId) {
			// The cached notes belong to someone else. Refuse to push: doing
			// so would disclose their note bodies into this user's account.
			result.skipped = true;
			result.reason = 'owner-mismatch';
			result.durationMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start);
			logSyncResult(result);
			return result;
		}
		const dirty = await getDirtyNotes(db);
		for (const note of dirty) {
			try {
				if (note.deleted_offline) {
					await syncDeletedNote(db, note, result);
				} else if (note.archived_offline) {
					await syncArchivedNote(db, note, result);
				} else if (note.is_new) {
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
		deleted: r.pushed.deleted,
		archived: r.pushed.archived,
		conflicts: r.conflicts,
		errors: r.errors,
		skipped: r.skipped,
		reason: r.reason,
		mappings: r.mappings.length,
	});
}

/**
 * Replay an offline delete. A note created offline and deleted before it ever
 * synced never existed server-side, so it is simply discarded; otherwise the
 * server delete runs first and the cache entry is only dropped on success, so
 * a failed call leaves the flag in place for the next sync to retry.
 * `deleted_offline` wins over `archived_offline` when both are set — the
 * user's last visible action was the delete.
 */
async function syncDeletedNote(db: IDBDatabase, note: CachedNote, result: SyncResult): Promise<void> {
	if (!note.is_new) {
		await api.notes.delete(note.id);
	}
	await deleteNote(db, note.id);
	result.pushed.deleted++;
}

/**
 * Replay an offline archive. Local title/body edits are pushed first so
 * archiving doesn't silently discard offline work; a note created offline is
 * created server-side and immediately archived. The cache entry is removed on
 * success — archived notes live outside the offline working set.
 */
async function syncArchivedNote(db: IDBDatabase, note: CachedNote, result: SyncResult): Promise<void> {
	let serverId = note.id;
	if (note.is_new) {
		const created = await api.notes.create(note.title, note.body);
		serverId = created.id;
	} else {
		await api.notes.update(note.id, { title: note.title, body: note.body });
	}
	await api.notes.archive(serverId);
	await deleteNote(db, note.id);
	result.pushed.archived++;
}

async function syncNewNote(db: IDBDatabase, note: CachedNote, result: SyncResult): Promise<void> {
	const serverNote = await api.notes.create(note.title, note.body);
	await deleteNote(db, note.id);
	await upsertNote(db, {
		id: serverNote.id,
		title: serverNote.title,
		body: serverNote.body,
		starred: serverNote.starred,
		locked: serverNote.locked,
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
			locked: serverNote.locked,
			pinned: serverNote.pinned,
			tags: note.tags,
			server_updated_at: serverNote.updated_at,
			local_updated_at: serverNote.updated_at,
			is_dirty: false,
			is_new: false,
		});
	}
}
