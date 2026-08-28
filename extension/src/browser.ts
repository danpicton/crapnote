import type { KVStore } from './core/storage';

// Firefox exposes the promise-based APIs on `browser`; Chromium's MV3
// `chrome` namespace is promise-based too, so one alias covers both.
declare const browser: typeof chrome | undefined;

export const ext: typeof chrome =
	typeof browser !== 'undefined' ? browser : chrome;

export function syncStore(): KVStore {
	return {
		get: (keys) => ext.storage.sync.get(keys),
		set: (items) => ext.storage.sync.set(items),
	};
}

export function localStore(): KVStore {
	return {
		get: (keys) => ext.storage.local.get(keys),
		set: (items) => ext.storage.local.set(items),
	};
}
