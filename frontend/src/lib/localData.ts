import { openOfflineDB, deleteOfflineDB, getOfflineOwner, setOfflineOwner, clearAllNotes } from '$lib/offlineDB';
import type { User } from '$lib/api';

// localStorage key holding the last authenticated user, so the PWA can
// restore the session identity when it starts offline (the /api/auth/me
// round-trip is impossible then). Cleared on logout with the rest of the
// local footprint.
const SESSION_USER_KEY = 'crapnote:session-user';

/** Remembers the authenticated user for offline session restore. */
export function persistSessionUser(user: User): void {
	try {
		localStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
	} catch {
		// Storage full / unavailable — offline restore just won't work.
	}
}

/** Returns the last authenticated user, or null if none was persisted. */
export function readSessionUser(): User | null {
	try {
		const raw = localStorage.getItem(SESSION_USER_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as User;
		return typeof parsed?.id === 'number' ? parsed : null;
	} catch {
		return null;
	}
}

/** Forgets the persisted user (logout, or server rejected the session). */
export function clearSessionUser(): void {
	try {
		localStorage.removeItem(SESSION_USER_KEY);
	} catch {
		// Nothing to clear if storage is unavailable.
	}
}

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
	clearSessionUser();
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
