// Minimal key-value storage abstraction so core logic never touches the
// chrome.storage API directly (keeps it testable and browser-agnostic).
export interface KVStore {
	get(keys: string[]): Promise<Record<string, unknown>>;
	set(items: Record<string, unknown>): Promise<void>;
}

export function memoryStore(initial: Record<string, unknown> = {}): KVStore {
	const data: Record<string, unknown> = { ...initial };
	return {
		async get(keys) {
			const out: Record<string, unknown> = {};
			for (const k of keys) {
				if (k in data) out[k] = data[k];
			}
			return out;
		},
		async set(items) {
			Object.assign(data, items);
		},
	};
}
