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
		sync.get(KEYS),
		local.get([...LOCAL_KEYS]),
	]);
	const migrated: Record<string, unknown> = {};
	for (const key of LOCAL_KEYS) {
		if (!(key in localValues) && typeof synced[key] === 'string') {
			migrated[key] = synced[key];
		}
	}
	if (Object.keys(migrated).length > 0) await local.set(migrated);

	const syncedTokenKeys = LOCAL_KEYS.filter((key) => key in synced);
	if (syncedTokenKeys.length > 0) await sync.remove([...syncedTokenKeys]);

	const stored = { ...synced, ...migrated, ...localValues };
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
