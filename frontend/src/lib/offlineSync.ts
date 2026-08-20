import { api, ApiError, OfflineError } from '$lib/api';
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
	 * `archived` count offline deletes/archives replayed against the API;
	 * `flags` counts notes whose starred/pinned/locked state was reconciled. */
	pushed: { created: number; updated: number; deleted: number; archived: number; flags: number };
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
		pushed: { created: 0, updated: 0, deleted: 0, archived: 0, flags: 0 },
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
					if (note.flags_dirty) {
						await syncNoteFlags(db, note, result);
					}
				} else {
					// Flags reconcile BEFORE the content push: an offline
					// unlock must reach the server first, or the PUT of the
					// offline edit bounces off the still-locked note with a
					// 423 on every retry and sync wedges on "unsynced".
					let current: CachedNote | null = note;
					if (current.flags_dirty) {
						current = await syncNoteFlags(db, current, result);
					}
					if (current?.is_dirty) {
						await syncDirtyNote(db, current, result);
					}
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
		flags: r.pushed.flags,
		conflicts: r.conflicts,
		errors: r.errors,
		skipped: r.skipped,
		reason: r.reason,
		mappings: r.mappings.length,
	});
}

/**
 * True when the replay target no longer exists server-side (deleted from
 * another device): the intent behind the queued action is already satisfied,
 * so the replay counts as done. Without this, a 404 would keep the flagged
 * note retrying — and the sync indicator stuck on "unsynced" — forever.
 */
function isGoneServerSide(err: unknown): boolean {
	return err instanceof ApiError && !(err instanceof OfflineError) && err.status === 404;
}

/** True when the server refused the write because the note is locked (423). */
function isLockedServerSide(err: unknown): boolean {
	return err instanceof ApiError && !(err instanceof OfflineError) && err.status === 423;
}

/**
 * Replay an offline delete. A note created offline and deleted before it ever
 * synced never existed server-side, so it is simply discarded; otherwise the
 * server delete runs first and the cache entry is only dropped on success
 * (or on a 404 — already gone), so a failed call leaves the flag in place
 * for the next sync to retry. `deleted_offline` wins over `archived_offline`
 * when both are set — the user's last visible action was the delete.
 */
async function syncDeletedNote(db: IDBDatabase, note: CachedNote, result: SyncResult): Promise<void> {
	if (!note.is_new) {
		try {
			await api.notes.delete(note.id);
		} catch (err) {
			if (isLockedServerSide(err) && note.flags_dirty && !(note.locked ?? false)) {
				// The user unlocked the note offline before deleting it, but
				// the unlock hasn't replayed (the delete branch runs first).
				// Apply the unlock, then delete.
				await api.notes.toggleLock(note.id);
				await api.notes.delete(note.id);
			} else if (!isGoneServerSide(err)) {
				throw err;
			}
		}
	}
	await deleteNote(db, note.id);
	result.pushed.deleted++;
}

/**
 * Replay an offline archive. The replay makes several server writes, so each
 * one is CHECKPOINTED into the cache entry before moving on — a retry after a
 * partial failure (create ok, archive failed) resumes where it left off
 * instead of re-running earlier writes and creating duplicate notes.
 *
 * The cached title/body is only pushed when the note carries offline content
 * edits (is_dirty), under the same conflict check as syncDirtyNote — a plain
 * archive must never clobber edits made from another device. On a content
 * conflict the local edits are preserved as a "[sync conflict]" note and the
 * server's version is archived as-is. Flags toggled offline (flags_dirty)
 * are reconciled before archiving, while the note is still active. The cache
 * entry is removed on success — archived notes live outside the offline
 * working set.
 */
async function syncArchivedNote(db: IDBDatabase, note: CachedNote, result: SyncResult): Promise<void> {
	let current = note;

	// 1. A note born offline is created server-side first. Checkpoint: re-key
	//    the cache entry to the server id and clear is_new, so a retry after
	//    a later failure never calls create again.
	if (current.is_new) {
		const created = await api.notes.create(current.title, current.body);
		await deleteNote(db, current.id);
		current = {
			...current,
			id: created.id,
			is_new: false,
			is_dirty: false,
			server_updated_at: created.updated_at,
			local_updated_at: created.updated_at,
		};
		await upsertNote(db, current);
		result.mappings.push({ tempId: note.id, serverId: created.id });
	}

	// 2. Flags toggled offline apply BEFORE the content push and the
	//    archive: an offline unlock must land first or the PUT below
	//    bounces off the still-locked note with a 423 forever. Checkpointed
	//    (flags_dirty cleared) so a retry skips straight past this step.
	if (current.flags_dirty) {
		const reconciled = await reconcileFlagsCheckpoint(db, { ...current, is_new: false }, result);
		if (reconciled === null) {
			// Gone server-side — the archive intent is moot.
			await deleteNote(db, current.id);
			result.pushed.archived++;
			return;
		}
		current = reconciled;
	}

	// 3. Push offline content edits (or preserve them as a conflict note).
	//    Checkpoint is_dirty:false either way, so a retried archive neither
	//    re-pushes nor mints a second conflict copy.
	if (current.is_dirty) {
		try {
			const serverNote = await api.notes.get(current.id);
			if (serverNote.updated_at === current.server_updated_at) {
				const updated = await api.notes.update(current.id, { title: current.title, body: current.body });
				current = {
					...current,
					is_dirty: false,
					server_updated_at: updated.updated_at,
					local_updated_at: updated.updated_at,
				};
			} else {
				result.conflicts++;
				await api.notes.create(`[sync conflict] ${current.title}`, current.body);
				current = { ...current, is_dirty: false };
			}
			await upsertNote(db, current);
		} catch (err) {
			// Note already deleted server-side — nothing to update; the
			// archive call below resolves the same way.
			if (!isGoneServerSide(err)) throw err;
		}
	}

	// 4. Archive, then drop the entry.
	try {
		await api.notes.archive(current.id);
	} catch (err) {
		if (!isGoneServerSide(err)) throw err;
	}
	await deleteNote(db, current.id);
	result.pushed.archived++;
}

/**
 * Reconcile the desired starred/pinned/locked state against the server,
 * toggling only the flags that differ — replaying raw toggles blind could
 * double-flip a flag another device already changed. Local desired state
 * wins. Persists the checkpointed entry (flags_dirty cleared) and returns
 * it, or null when the note no longer exists server-side.
 *
 * updated_at bookkeeping: our own toggles bump the server's updated_at, so
 * the conflict baseline is fast-forwarded past them — EXCEPT when content
 * edits are pending AND the server's content genuinely changed since our
 * last sync, in which case the old baseline is kept so the content push
 * still detects the real conflict.
 */
async function reconcileFlagsCheckpoint(
	db: IDBDatabase,
	note: CachedNote,
	result: SyncResult
): Promise<CachedNote | null> {
	let current;
	try {
		current = await api.notes.get(note.id);
	} catch (err) {
		if (isGoneServerSide(err)) return null;
		throw err;
	}
	// Decide whether a genuine server-side change is pending BEFORE our own
	// toggles bump updated_at.
	const serverChanged = current.updated_at !== note.server_updated_at;
	if (note.starred !== current.starred) current = await api.notes.toggleStar(note.id);
	if (note.pinned !== current.pinned) current = await api.notes.togglePin(note.id);
	if ((note.locked ?? false) !== current.locked) current = await api.notes.toggleLock(note.id);

	const updated: CachedNote = {
		...note,
		starred: current.starred,
		pinned: current.pinned,
		locked: current.locked,
		flags_dirty: false,
		...(note.is_dirty && serverChanged
			? {} // real conflict pending — keep the old baseline
			: {
					server_updated_at: current.updated_at,
					...(note.is_dirty ? {} : { local_updated_at: current.updated_at }),
				}),
	};
	await upsertNote(db, updated);
	result.pushed.flags++;
	return updated;
}

/**
 * Reconcile starred/pinned/locked toggled offline for an active note. The
 * cached values are the user's desired state. Returns the checkpointed
 * entry the content push should continue from, or null when the note is
 * gone server-side (the cache entry is dropped).
 */
async function syncNoteFlags(db: IDBDatabase, note: CachedNote, result: SyncResult): Promise<CachedNote | null> {
	// An offline-created note gets its server id earlier in this same run
	// (syncNewNote re-keys the cache entry and records a mapping); the
	// snapshot from getDirtyNotes still carries the temp id and is_new.
	const mapping = result.mappings.find((m) => m.tempId === note.id);
	const snapshot = mapping
		? { ...note, id: mapping.serverId, is_new: false, is_dirty: false }
		: note;

	const updated = await reconcileFlagsCheckpoint(db, snapshot, result);
	if (updated === null) {
		// Deleted from another device — nothing left to reconcile.
		await deleteNote(db, snapshot.id);
		return null;
	}
	return updated;
}

async function syncNewNote(db: IDBDatabase, note: CachedNote, result: SyncResult): Promise<void> {
	const serverNote = await api.notes.create(note.title, note.body);
	await deleteNote(db, note.id);
	// Flags toggled offline survive the re-key: keep the DESIRED values and
	// flags_dirty on the persisted entry, so if the flag reconcile that runs
	// after this fails mid-way, the next sync still retries it instead of
	// silently reporting "synced" with the toggle lost.
	await upsertNote(db, {
		id: serverNote.id,
		title: serverNote.title,
		body: serverNote.body,
		starred: note.flags_dirty ? note.starred : serverNote.starred,
		locked: note.flags_dirty ? (note.locked ?? false) : serverNote.locked,
		pinned: note.flags_dirty ? note.pinned : serverNote.pinned,
		tags: note.tags, // preserve any tags the user added offline
		server_updated_at: serverNote.updated_at,
		local_updated_at: serverNote.updated_at,
		is_dirty: false,
		is_new: false,
		flags_dirty: note.flags_dirty,
	});
	result.mappings.push({ tempId: note.id, serverId: serverNote.id });
	result.pushed.created++;
}

async function syncDirtyNote(db: IDBDatabase, note: CachedNote, result: SyncResult): Promise<void> {
	const serverNote = await api.notes.get(note.id);

	if (serverNote.updated_at === note.server_updated_at) {
		// No server-side change since we last synced — our version wins cleanly
		let updated;
		try {
			updated = await api.notes.update(note.id, { title: note.title, body: note.body });
		} catch (err) {
			if (!isLockedServerSide(err)) throw err;
			// The note is locked server-side (locked from another device, or
			// an unlock replay that couldn't land). Retrying the PUT would
			// fail identically forever — preserve the offline edit as a
			// conflict note and accept the server's version instead.
			result.conflicts++;
			await api.notes.create(`[sync conflict] ${note.title}`, note.body);
			await upsertNote(db, {
				...note,
				title: serverNote.title,
				body: serverNote.body,
				starred: serverNote.starred,
				pinned: serverNote.pinned,
				locked: serverNote.locked,
				server_updated_at: serverNote.updated_at,
				local_updated_at: serverNote.updated_at,
				is_dirty: false,
			});
			return;
		}
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
		let updated;
		try {
			updated = await api.notes.update(note.id, { title: note.title, body: note.body });
		} catch (err) {
			if (!isLockedServerSide(err)) throw err;
			// Locked server-side — the local edit can't win after all. Keep
			// it as its own conflict note and accept the server's version so
			// sync never wedges on the 423.
			await api.notes.create(`[sync conflict] ${note.title}`, note.body);
			await upsertNote(db, {
				...note,
				title: serverNote.title,
				body: serverNote.body,
				starred: serverNote.starred,
				pinned: serverNote.pinned,
				locked: serverNote.locked,
				server_updated_at: serverNote.updated_at,
				local_updated_at: serverNote.updated_at,
				is_dirty: false,
			});
			return;
		}
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
