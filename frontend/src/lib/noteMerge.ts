import type { Note } from './api';
import { noteFlags, type CachedNote } from './offlineDB';

/** Overlay only queued work. Privacy isn't an offline toggle: server privacy
 * governs server content, while unsynced content retains the stricter value
 * until an explicit privacy write acknowledges it in the cache.
 */
export function mergeCachedNote(server: Note, cached: CachedNote | null | undefined): Note {
	if (!cached || cached.is_new || (!cached.is_dirty && !cached.flags_dirty)) return server;
	const merged = { ...server };
	if (cached.flags_dirty) {
		const toggled = cached.flags_toggled ?? { starred: true, pinned: true, locked: true };
		const flags = noteFlags(cached, server);
		if (toggled.starred) merged.starred = flags.starred;
		if (toggled.locked) merged.locked = flags.locked;
		if (toggled.pinned) {
			merged.pinned = flags.pinned;
			merged.pin_order = flags.pin_order;
		}
	}
	if (cached.is_dirty) {
		merged.title = cached.title;
		merged.body = cached.body;
		merged.updated_at = cached.local_updated_at;
	}
	merged.private = !!server.private || (cached.is_dirty && !!cached.private);
	return merged;
}
