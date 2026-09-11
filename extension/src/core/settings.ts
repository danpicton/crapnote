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
const SYNC_KEYS = [
	'serverUrl',
	'defaultLinkTag',
	'defaultClipTag',
	'readeckUrl',
] as const satisfies readonly (keyof Settings)[];
const LOCAL_KEYS = ['apiToken', 'readeckToken'] as const satisfies readonly (keyof Settings)[];

export async function loadSettings(sync: KVStore, local: KVStore): Promise<Settings> {
	const [synced, localValues] = await Promise.all([
		sync.get([...SYNC_KEYS]),
		local.get([...LOCAL_KEYS]),
	]);
	const stored = { ...synced, ...localValues };
	const settings = { ...DEFAULT_SETTINGS };
	for (const key of KEYS) {
		const value = stored[key];
		if (typeof value === 'string') settings[key] = value;
	}
	settings.serverUrl = settings.serverUrl.replace(/\/+$/, '');
	settings.readeckUrl = settings.readeckUrl.replace(/\/+$/, '');
	return settings;
}

export async function saveSettings(
	sync: KVStore,
	local: KVStore,
	settings: Settings,
): Promise<void> {
	await Promise.all([
		sync.set(Object.fromEntries(SYNC_KEYS.map((key) => [key, settings[key]]))),
		local.set(Object.fromEntries(LOCAL_KEYS.map((key) => [key, settings[key]]))),
	]);
}
