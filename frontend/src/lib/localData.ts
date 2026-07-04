import { openOfflineDB, deleteOfflineDB, getOfflineOwner, setOfflineOwner, clearAllNotes } from '$lib/offlineDB';

/**
 * Wipes every locally persisted trace of the authenticated user: the
 * service-worker Cache Storage entries (cached /api responses and app shell)
 * and the offline notes IndexedDB. Called at logout so the next person on a
 * shared browser cannot read the previous user's notes. Best-effort — a
 * failure to clear must never block the logout itself.
 */
export async function clearLocalData(): Promise<void> {
	try {
		if (typeof caches !== 'undefined') {
			const keys = await caches.keys();
			await Promise.all(keys.filter((k) => k.startsWith('crapnote-')).map((k) => caches.delete(k)));
		}
	} catch {
		// Cache Storage unavailable (old browser, private mode) — nothing cached.
	}
	try {
		if (typeof indexedDB !== 'undefined') {
			await deleteOfflineDB();
		}
	} catch {
		// Same: if IDB is unavailable there is nothing to clear.
	}
}

/**
 * Binds the offline store to the given user. If the store currently belongs
 * to a different user (shared browser, previous session not logged out
 * cleanly), the cached notes and cached /api responses are wiped first so
 * nothing leaks across accounts. Called after login and after session
 * restore, before any sync can run.
 */
export async function ensureOfflineOwner(userId: number): Promise<void> {
	try {
		const db = await openOfflineDB();
		try {
			const owner = await getOfflineOwner(db);
			if (owner !== null && owner !== userId) {
				await clearAllNotes(db);
				try {
					if (typeof caches !== 'undefined') {
						const keys = await caches.keys();
						await Promise.all(keys.filter((k) => k.startsWith('crapnote-')).map((k) => caches.delete(k)));
					}
				} catch {
					// best-effort, as above
				}
			}
			await setOfflineOwner(db, userId);
		} finally {
			db.close();
		}
	} catch {
		// If the store can't be opened, there's nothing to rebind — the sync
		// guard in offlineSync refuses to push without a matching owner anyway.
	}
}
