import { noteFlags, updateCachedNote, type CachedNote, type NoteFlags } from './offlineDB';
import type { Note } from './api';

type ContentField = 'title' | 'body';
type SavedContent = { id: number; title: string; body: string; updated_at: string } & Partial<NoteFlags>;

/** Keep the exact server timestamp used by sync's equality check. Go emits
 * nanoseconds, which Date.parse alone would truncate to milliseconds.
 */
export function latestTimestamp(current: string, incoming: string): string {
	const currentMs = Date.parse(current);
	const incomingMs = Date.parse(incoming);
	if (currentMs !== incomingMs) return incomingMs > currentMs ? incoming : current;
	const fraction = (value: string) => (value.match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/)?.[1] ?? '').padEnd(9, '0');
	return fraction(incoming) > fraction(current) ? incoming : current;
}

/** A content response can reveal privacy set on another device. Retain that
 * protection for local content; a public response must not declassify a dirty
 * sibling or undo a newer private response. Explicit privacy writes can clear
 * it via acknowledgeCachedPrivacy.
 */
export function learnedPrivacy(updated: Partial<NoteFlags>, acceptPrivacy = true): { private?: boolean } {
	return acceptPrivacy && updated.private ? { private: true } : {};
}

export type ToggleFlag = 'starred' | 'pinned' | 'locked';

/** A flag response acknowledges only that flag, not its entire note snapshot.
 * Preserve newer content, other flags and explicit privacy writes. As with
 * content saves, newly observed privacy may only add protection.
 */
export function mergeSavedFlag(current: Note, updated: Note, flag: ToggleFlag, acceptPrivacy = true): Note {
	return {
		...current,
		[flag]: updated[flag],
		...(flag === 'pinned' ? { pin_order: noteFlags(updated, current).pin_order } : {}),
		...learnedPrivacy(updated, acceptPrivacy),
	};
}

/** Cache privacy learned from a response without acknowledging its stale
 * content or flags. The guard is checked again inside the write transaction.
 */
export async function cacheLearnedPrivacy(
	openCache: () => Promise<IDBDatabase | null>,
	updated: SavedContent,
	acceptPrivacy: () => boolean,
): Promise<boolean> {
	if (!updated.private || !acceptPrivacy()) return true;
	return cacheSavedNote(openCache, 'private', updated, acceptPrivacy);
}

/** Acknowledgement is field-specific, even when the cache has unsynced edits.
 * Skipping a dirty row would leave a superseded offline title to be replayed.
 * Never copy the response's other field: it can predate another save or an
 * offline edit. Only clear content dirtiness when both cached fields match
 * the acknowledged server snapshot; queued actions/flags remain untouched.
 */
export function acknowledgeCachedSave(
	current: CachedNote | null,
	field: ContentField,
	updated: SavedContent,
	isLatestRequest = true,
	tags: CachedNote['tags'] = [],
	acceptPrivacy = true,
): CachedNote {
	current ??= {
		id: updated.id, title: updated.title, body: updated.body, ...noteFlags(updated), tags,
		server_updated_at: updated.updated_at, local_updated_at: updated.updated_at,
		is_dirty: false, is_new: false,
	};
	const next = isLatestRequest ? { ...current, [field]: updated[field] } : current;
	const is_dirty = current.is_dirty && (next.title !== updated.title || next.body !== updated.body);
	// This is a whole-note conflict baseline, not merely the last response time.
	// A partial PUT cannot acknowledge a differing dirty sibling (or a newer
	// same-field edit). Retain its baseline until all local content is accounted
	// for; otherwise sync would silently overwrite concurrent remote changes.
	const server_updated_at = is_dirty
		? current.server_updated_at
		: latestTimestamp(current.server_updated_at, updated.updated_at);
	return {
		...next,
		...learnedPrivacy(updated, acceptPrivacy),
		is_dirty,
		server_updated_at,
		local_updated_at: is_dirty ? current.local_updated_at : server_updated_at,
	};
}

/** An explicit privacy write supersedes cached privacy even on a dirty row.
 * It acknowledges no title/body edit or queued action. Advance the content
 * checkpoint only when the response accounts for the cached content, so a
 * later offline edit doesn't mistake our own privacy write for a conflict.
 */
export function acknowledgeCachedPrivacy(
	current: CachedNote | null,
	updated: SavedContent,
	tags: CachedNote['tags'] = [],
): CachedNote {
	if (!current) return acknowledgeCachedSave(null, 'title', updated, true, tags);
	const sameContent = current.title === updated.title && current.body === updated.body;
	const checkpoint = latestTimestamp(current.server_updated_at, updated.updated_at);
	return {
		...current,
		private: updated.private ?? false,
		...(sameContent ? {
			server_updated_at: checkpoint,
			local_updated_at: current.is_dirty ? current.local_updated_at : checkpoint,
		} : {}),
	};
}

export const CACHE_SAVE_WARNING =
	'Saved to the server, but the offline cache could not be updated. Offline copies may be out of date.';

/** Called only after a successful server PUT. Cache availability must not turn
 * that success into a failed title commit or an unsynced-content retry. Keep
 * ownership checks and transaction cleanup, but report a degraded cache via
 * the return value rather than rejecting navigation/action waiters.
 */
export async function cacheSavedNote(
	openCache: () => Promise<IDBDatabase | null>,
	field: ContentField | 'private',
	updated: SavedContent,
	isLatestRequest: () => boolean,
	tags: CachedNote['tags'] = [],
	acceptPrivacy: () => boolean = () => true,
): Promise<boolean> {
	try {
		const db = await openCache();
		if (!db) return false;
		try {
			await updateCachedNote(db, updated.id, (current) => {
				if (field === 'private') {
					return isLatestRequest() ? acknowledgeCachedPrivacy(current, updated, tags) : current;
				}
				return acknowledgeCachedSave(current, field, updated, isLatestRequest(), tags, acceptPrivacy());
			});
		} finally {
			db.close();
		}
		return true;
	} catch {
		return false;
	}
}

// Shared across editor lifetimes: navigation can leave a content PUT from
// the previous route in flight while the new route explicitly clears privacy.
const privacyWrites = new Map<number, symbol>();

/** Later same-field attempts (including offline fallbacks) supersede older
 * responses, but a body attempt must not supersede a title acknowledgement.
 */
export class SaveRequests {
	private latest = new Map<string, symbol>();

	/** A later explicit privacy write supersedes privacy inferred from any
	 * earlier content request, even across fields or equal server timestamps.
	 */
	guardPrivacy(id: number): () => boolean {
		const write = privacyWrites.get(id);
		return () => privacyWrites.get(id) === write;
	}

	privacyChanged(id: number): void {
		privacyWrites.set(id, Symbol());
	}

	begin(id: number, field: ContentField): () => boolean {
		const key = `${id}:${field}`;
		const token = Symbol();
		this.latest.set(key, token);
		return () => this.latest.get(key) === token;
	}
}
