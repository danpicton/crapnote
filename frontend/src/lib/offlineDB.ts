export interface CachedNote {
	id: number;                 // server ID, or negative temp ID for offline-created notes
	title: string;
	body: string;
	starred: boolean;
	pinned: boolean;
	locked?: boolean;           // absent on records cached before locking shipped
	tags: Array<{ id: number; name: string }>;  // cached for offline tag-filtering
	server_updated_at: string;  // server's updated_at when we last fetched — used for conflict detection
	local_updated_at: string;   // ISO string of last local modification
	is_dirty: boolean;          // has unsynced local changes
	is_new: boolean;            // created offline; no server ID yet
}

const DB_NAME = 'crapnote-notes-v2';
const DB_VERSION = 2;
const STORE = 'notes';
// Key/value store holding the id of the user the cached notes belong to.
// The store is shared per-browser, so every read-for-display and every sync
// push must be checked against it — otherwise user A's offline edits would
// sync into user B's account on a shared machine.
const META_STORE = 'meta';
const OWNER_KEY = 'owner';

export function openOfflineDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = (e) => {
			const db = (e.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(STORE)) {
				db.createObjectStore(STORE, { keyPath: 'id' });
			}
			if (!db.objectStoreNames.contains(META_STORE)) {
				db.createObjectStore(META_STORE, { keyPath: 'key' });
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

/** Deletes the entire offline database (used at logout). */
export function deleteOfflineDB(): Promise<void> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.deleteDatabase(DB_NAME);
		req.onsuccess = () => resolve();
		// Blocked means another open connection delays the delete — it still
		// completes once that connection closes, so don't fail the logout.
		req.onblocked = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

/** Returns the user id the offline store belongs to, or null if unset. */
export function getOfflineOwner(db: IDBDatabase): Promise<number | null> {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(META_STORE, 'readonly');
		const req = tx.objectStore(META_STORE).get(OWNER_KEY);
		req.onsuccess = () => {
			const row = req.result as { key: string; userId: number } | undefined;
			resolve(typeof row?.userId === 'number' ? row.userId : null);
		};
		req.onerror = () => reject(req.error);
	});
}

/** Records which user the offline store belongs to. */
export function setOfflineOwner(db: IDBDatabase, userId: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(META_STORE, 'readwrite');
		tx.objectStore(META_STORE).put({ key: OWNER_KEY, userId });
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

/** Removes every cached note (owner metadata is left as-is). */
export function clearAllNotes(db: IDBDatabase): Promise<void> {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		tx.objectStore(STORE).clear();
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

export function upsertNote(db: IDBDatabase, note: CachedNote): Promise<void> {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		tx.objectStore(STORE).put(note);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

export function getNote(db: IDBDatabase, id: number): Promise<CachedNote | null> {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readonly');
		const req = tx.objectStore(STORE).get(id);
		req.onsuccess = () => resolve((req.result as CachedNote) ?? null);
		req.onerror = () => reject(req.error);
	});
}

export function getAllNotes(db: IDBDatabase): Promise<CachedNote[]> {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readonly');
		const req = tx.objectStore(STORE).getAll();
		req.onsuccess = () => resolve(req.result as CachedNote[]);
		req.onerror = () => reject(req.error);
	});
}

export function getDirtyNotes(db: IDBDatabase): Promise<CachedNote[]> {
	return getAllNotes(db).then((notes) => notes.filter((n) => n.is_dirty));
}

export function deleteNote(db: IDBDatabase, id: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		tx.objectStore(STORE).delete(id);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}
