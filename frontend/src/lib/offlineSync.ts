import { api, ApiError, OfflineError } from '$lib/api';
import { openOfflineDB, getDirtyNotes, upsertNote, deleteNote, getOfflineOwner, setOfflineOwner, noteFlags } from '$lib/offlineDB';
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
				} else {
					await runReplayPhases(db, note, result);
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
			if (isLockedServerSide(err) && note.flags_toggled?.locked && !(note.locked ?? false)) {
				// The user EXPLICITLY unlocked this note offline before
				// deleting it, but the unlock hasn't replayed (the delete
				// branch runs first). Apply the unlock, then delete. Gated on
				// the lock flag itself having been toggled — a stale cached
				// locked:false plus some other toggle must never strip a lock
				// another device set.
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
 * Replay an offline archive: run the shared phases (create / flags / content
 * / deferred lock), then archive and drop the cache entry. Each phase
 * checkpoints, so a retry after a partial failure resumes where it left off
 * instead of re-running earlier writes.
 */
async function syncArchivedNote(db: IDBDatabase, note: CachedNote, result: SyncResult): Promise<void> {
	const current = await runReplayPhases(db, note, result);
	if (current === null) {
		// Gone server-side mid-phase — the archive intent is moot and the
		// entry has already been dropped.
		result.pushed.archived++;
		return;
	}
	try {
		await api.notes.archive(current.id);
	} catch (err) {
		if (!isGoneServerSide(err)) throw err;
	}
	await deleteNote(db, current.id);
	result.pushed.archived++;
}

/**
 * The ordered replay for a note that stays active (and the pre-archive
 * phases for one that doesn't):
 *
 *   1. create it server-side if it was born offline (checkpoint: re-key);
 *   2. reconcile flag toggles — EXCEPT a lock-on when content edits are
 *      still pending, which is deferred (checkpoint: flags cleared, or
 *      narrowed to the deferred lock);
 *   3. push content edits under the conflict check (checkpoint: is_dirty
 *      cleared either way);
 *   4. apply the deferred lock-on.
 *
 * Unlock-before-content is what keeps an offline unlock+edit from wedging
 * on 423s; lock-AFTER-content is what keeps an offline edit+lock from
 * 423-ing its own PUT and mangling the edit into a conflict copy.
 *
 * Returns the final cache entry, or null when the note turned out to be
 * deleted server-side (the entry is dropped).
 */
async function runReplayPhases(db: IDBDatabase, note: CachedNote, result: SyncResult): Promise<CachedNote | null> {
	let current = note;

	if (current.is_new) {
		current = await syncNewNote(db, current, result);
	}

	let otherDeviceEditTime: string | undefined;
	if (current.flags_dirty) {
		const reconciled = await reconcileFlagsCheckpoint(db, current, result, current.is_dirty);
		if (reconciled === null) {
			await deleteNote(db, current.id);
			return null;
		}
		current = reconciled.entry;
		otherDeviceEditTime = reconciled.otherDeviceEditTime;
	}

	if (current.is_dirty) {
		const pushed = await pushContentCheckpoint(db, current, result, otherDeviceEditTime);
		if (pushed === null) return null;
		current = pushed;
	}

	if (current.flags_dirty) {
		// Only a deferred lock-on can still be pending here.
		const reconciled = await reconcileFlagsCheckpoint(db, current, result, false);
		if (reconciled === null) {
			await deleteNote(db, current.id);
			return null;
		}
		current = reconciled.entry;
	}

	return current;
}

/**
 * Create an offline-born note server-side and re-key its cache entry to the
 * server id — the checkpoint that makes every later phase (and the archive
 * call) retry-safe without duplicating the create. Everything queued on the
 * entry (archive intent, flag toggles, tags) survives the re-key; content is
 * carried by the create itself, so is_dirty clears.
 */
async function syncNewNote(db: IDBDatabase, note: CachedNote, result: SyncResult): Promise<CachedNote> {
	const serverNote = await api.notes.create(note.title, note.body);
	await deleteNote(db, note.id);
	const entry: CachedNote = {
		...note,
		id: serverNote.id,
		title: serverNote.title,
		body: serverNote.body,
		// Desired flag values stay when toggles are queued; otherwise mirror
		// the server's (default) values.
		...(note.flags_dirty ? {} : noteFlags(serverNote)),
		server_updated_at: serverNote.updated_at,
		local_updated_at: serverNote.updated_at,
		is_dirty: false,
		is_new: false,
	};
	await upsertNote(db, entry);
	result.mappings.push({ tempId: note.id, serverId: serverNote.id });
	result.pushed.created++;
	return entry;
}

/**
 * Reconcile the flags the user actually toggled offline against the server,
 * flipping only where they differ — replaying raw toggles blind could
 * double-flip a flag another device already changed, and touching flags the
 * user never toggled could strip state (e.g. a lock) set elsewhere. Local
 * desired state wins for the toggled flags.
 *
 * A lock-ON is deferred while content edits are pending (`deferLockOn`):
 * locking first would make our own content PUT bounce with a 423. The entry
 * checkpoints with the remaining work narrowed to that deferred lock.
 *
 * updated_at bookkeeping: the backend's flag setters deliberately write only
 * the flag column (see repository.go setBool), so today our toggles do NOT
 * move the server's updated_at. The baseline fast-forward and the returned
 * pre-toggle timestamp are therefore no-ops in practice — kept as cheap
 * insurance so a future backend change that bumps updated_at on toggles
 * neither manufactures phantom conflicts nor skews the conflict winner.
 * When content edits are pending AND the server genuinely changed, the old
 * baseline is kept so the content push still detects the real conflict.
 *
 * Returns null when the note no longer exists server-side.
 */
async function reconcileFlagsCheckpoint(
	db: IDBDatabase,
	note: CachedNote,
	result: SyncResult,
	deferLockOn: boolean
): Promise<{ entry: CachedNote; otherDeviceEditTime?: string } | null> {
	let current;
	try {
		current = await api.notes.get(note.id);
	} catch (err) {
		if (isGoneServerSide(err)) return null;
		throw err;
	}
	// Legacy entries (pre flags_toggled) fall back to reconciling everything.
	const toggled = note.flags_toggled ?? { starred: true, pinned: true, locked: true };
	// Decide whether a genuine server-side change is pending BEFORE our own
	// toggles bump updated_at, and remember the other device's edit time.
	const serverChanged = current.updated_at !== note.server_updated_at;
	const preToggleUpdatedAt = current.updated_at;

	if (toggled.starred && note.starred !== current.starred) current = await api.notes.toggleStar(note.id);
	if (toggled.pinned && note.pinned !== current.pinned) current = await api.notes.togglePin(note.id);
	let lockDeferred = false;
	if (toggled.locked && (note.locked ?? false) !== current.locked) {
		if (!(note.locked ?? false) || !deferLockOn) {
			current = await api.notes.toggleLock(note.id);
		} else {
			lockDeferred = true;
		}
	}

	const entry: CachedNote = {
		...note,
		// The server owns these now — in particular pin_order, where a note
		// pinned offline carries only the client's guess (nextPinOrder).
		...noteFlags(current, note),
		...(lockDeferred ? { locked: true } : {}),
		flags_dirty: lockDeferred,
		flags_toggled: lockDeferred ? { locked: true } : undefined,
		...(note.is_dirty && serverChanged
			? {} // real conflict pending — keep the old baseline
			: {
					server_updated_at: current.updated_at,
					...(note.is_dirty ? {} : { local_updated_at: current.updated_at }),
				}),
	};
	await upsertNote(db, entry);
	if (!lockDeferred) result.pushed.flags++;
	return { entry, otherDeviceEditTime: serverChanged ? preToggleUpdatedAt : undefined };
}

/**
 * Push offline content edits under the conflict check, checkpointing the
 * outcome. Both PUT sites tolerate a 423 (locked from another device) by
 * preserving the local edit as a "[sync conflict]" note and accepting the
 * server's version — a locked note must never wedge sync in a retry loop.
 * `otherDeviceEditTime` carries the pre-toggle server timestamp when our own
 * flag reconcile bumped updated_at, so the conflict winner is judged against
 * the other device's real edit time. Returns null when the note is gone
 * server-side (the entry is dropped).
 */
async function pushContentCheckpoint(
	db: IDBDatabase,
	note: CachedNote,
	result: SyncResult,
	otherDeviceEditTime?: string
): Promise<CachedNote | null> {
	let serverNote;
	try {
		serverNote = await api.notes.get(note.id);
	} catch (err) {
		if (isGoneServerSide(err)) {
			await deleteNote(db, note.id);
			return null;
		}
		throw err;
	}

	/** Accept the server's version, preserving the local edit as a conflict note. */
	const preserveLocalAsConflict = async (): Promise<CachedNote> => {
		await api.notes.create(`[sync conflict] ${note.title}`, note.body);
		const entry: CachedNote = {
			...note,
			title: serverNote.title,
			body: serverNote.body,
			...noteFlags(serverNote, note),
			server_updated_at: serverNote.updated_at,
			local_updated_at: serverNote.updated_at,
			is_dirty: false,
		};
		await upsertNote(db, entry);
		return entry;
	};

	if (serverNote.updated_at === note.server_updated_at) {
		// No server-side change since we last synced — our version wins cleanly
		let updated;
		try {
			updated = await api.notes.update(note.id, { title: note.title, body: note.body });
		} catch (err) {
			if (!isLockedServerSide(err)) throw err;
			result.conflicts++;
			return preserveLocalAsConflict();
		}
		const entry: CachedNote = {
			...note,
			title: updated.title,
			body: updated.body,
			server_updated_at: updated.updated_at,
			local_updated_at: updated.updated_at,
			is_dirty: false,
		};
		await upsertNote(db, entry);
		result.pushed.updated++;
		return entry;
	}

	// Conflict: both sides changed since our last sync.
	// Winner is whichever was edited most recently; loser is preserved as a
	// new note prefixed with "[sync conflict]" so the user can reconcile
	// manually.
	result.conflicts++;
	const serverEditTime = otherDeviceEditTime ?? serverNote.updated_at;
	const localWins = new Date(note.local_updated_at).getTime() > new Date(serverEditTime).getTime();

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
			return preserveLocalAsConflict();
		}
		const entry: CachedNote = {
			...note,
			title: updated.title,
			body: updated.body,
			server_updated_at: updated.updated_at,
			local_updated_at: updated.updated_at,
			is_dirty: false,
		};
		await upsertNote(db, entry);
		result.pushed.updated++;
		return entry;
	}

	// Server wins. Preserve the local edit as a conflict note, then accept server.
	return preserveLocalAsConflict();
}
