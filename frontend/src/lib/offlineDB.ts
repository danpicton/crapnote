export interface CachedNote {
	id: number;                 // server ID, or negative temp ID for offline-created notes
	title: string;
	body: string;
	starred: boolean;
	pinned: boolean;
	tags: Array<{ id: number; name: string }>;  // cached for offline tag-filtering
	server_updated_at: string;  // server's updated_at when we last fetched — used for conflict detection
	local_updated_at: string;   // ISO string of last local modification
	is_dirty: boolean;          // has unsynced local changes
	is_new: boolean;            // created offline; no server ID yet
}

const DB_NAME = 'crapnote-notes-v2';
const DB_VERSION = 1;
const STORE = 'notes';

export function openOfflineDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = (e) => {
			const db = (e.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(STORE)) {
				db.createObjectStore(STORE, { keyPath: 'id' });
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
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
