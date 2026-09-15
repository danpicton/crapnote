import { noteFlags, type CachedNote, type NoteFlags } from './offlineDB';

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
): CachedNote {
	current ??= {
		id: updated.id, title: updated.title, body: updated.body, ...noteFlags(updated), tags,
		server_updated_at: updated.updated_at, local_updated_at: updated.updated_at,
		is_dirty: false, is_new: false,
	};
	const next = isLatestRequest ? { ...current, [field]: updated[field] } : current;
	const is_dirty = current.is_dirty && (next.title !== updated.title || next.body !== updated.body);
	const server_updated_at = latestTimestamp(current.server_updated_at, updated.updated_at);
	return {
		...next,
		is_dirty,
		server_updated_at,
		local_updated_at: is_dirty ? current.local_updated_at : server_updated_at,
	};
}

/** Later same-field attempts (including offline fallbacks) supersede older
 * responses, but a body attempt must not supersede a title acknowledgement.
 */
export class SaveRequests {
	private latest = new Map<string, symbol>();

	begin(id: number, field: ContentField): () => boolean {
		const key = `${id}:${field}`;
		const token = Symbol();
		this.latest.set(key, token);
		return () => this.latest.get(key) === token;
	}
}
