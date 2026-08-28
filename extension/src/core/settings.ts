import type { KVStore } from './storage';

export interface Settings {
	serverUrl: string;
	apiToken: string;
	defaultLinkTag: string;
	defaultClipTag: string;
	readeckUrl: string;
	readeckToken: string;
}

export const DEFAULT_SETTINGS: Settings = {
	serverUrl: '',
	apiToken: '',
	defaultLinkTag: 'Links',
	defaultClipTag: 'Webclip',
	readeckUrl: '',
	readeckToken: '',
};

const KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

export async function loadSettings(store: KVStore): Promise<Settings> {
	const stored = await store.get(KEYS);
	const settings = { ...DEFAULT_SETTINGS };
	for (const key of KEYS) {
		const value = stored[key];
		if (typeof value === 'string') settings[key] = value;
	}
	settings.serverUrl = settings.serverUrl.replace(/\/+$/, '');
	settings.readeckUrl = settings.readeckUrl.replace(/\/+$/, '');
	return settings;
}

export async function saveSettings(store: KVStore, settings: Settings): Promise<void> {
	await store.set({ ...settings });
}
