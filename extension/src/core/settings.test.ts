import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings';
import { memoryStore } from './storage';

describe('settings', () => {
	it('saves tokens locally and preferences in sync storage', async () => {
		const sync = memoryStore();
		const local = memoryStore();
		await saveSettings(sync, local, {
			serverUrl: 'https://notes.example.com',
			apiToken: 'tok123',
			defaultLinkTag: 'Bookmarks',
			defaultClipTag: 'Clips',
			readeckUrl: 'https://readeck.example.com',
			readeckToken: 'rd456',
		});

		expect(await sync.get(Object.keys(DEFAULT_SETTINGS))).toEqual({
			serverUrl: 'https://notes.example.com',
			defaultLinkTag: 'Bookmarks',
			defaultClipTag: 'Clips',
			readeckUrl: 'https://readeck.example.com',
		});
		expect(await local.get(Object.keys(DEFAULT_SETTINGS))).toEqual({
			apiToken: 'tok123',
			readeckToken: 'rd456',
		});
	});

	it('loads tokens locally and preferences from sync storage', async () => {
		const sync = memoryStore({
			serverUrl: 'https://notes.example.com',
			apiToken: 'wrong-sync-token',
			defaultLinkTag: 'Bookmarks',
			defaultClipTag: 'Clips',
			readeckUrl: 'https://readeck.example.com',
			readeckToken: 'wrong-sync-readeck-token',
		});
		const local = memoryStore({ apiToken: 'local-token', readeckToken: 'local-readeck-token' });

		expect(await loadSettings(sync, local)).toEqual({
			serverUrl: 'https://notes.example.com',
			apiToken: 'local-token',
			defaultLinkTag: 'Bookmarks',
			defaultClipTag: 'Clips',
			readeckUrl: 'https://readeck.example.com',
			readeckToken: 'local-readeck-token',
		});
		expect(await local.get(['apiToken', 'readeckToken'])).toEqual({
			apiToken: 'local-token',
			readeckToken: 'local-readeck-token',
		});
		expect(await sync.get(['apiToken', 'readeckToken'])).toEqual({});
	});

	it('migrates synced tokens to local storage and removes the synced copies', async () => {
		const sync = memoryStore({
			serverUrl: 'https://notes.example.com',
			apiToken: 'old-api-token',
			readeckToken: 'old-readeck-token',
		});
		const local = memoryStore();

		const settings = await loadSettings(sync, local);

		expect(settings.apiToken).toBe('old-api-token');
		expect(settings.readeckToken).toBe('old-readeck-token');
		expect(await local.get(['apiToken', 'readeckToken'])).toEqual({
			apiToken: 'old-api-token',
			readeckToken: 'old-readeck-token',
		});
		expect(await sync.get(['apiToken', 'readeckToken'])).toEqual({});
	});

	it('does no migration writes after tokens have been migrated', async () => {
		const sync = memoryStore({ apiToken: 'old-api-token' });
		const local = memoryStore();
		const setLocal = vi.spyOn(local, 'set');
		const removeSynced = vi.spyOn(sync, 'remove');
		await loadSettings(sync, local);
		setLocal.mockClear();
		removeSynced.mockClear();

		const settings = await loadSettings(sync, local);

		expect(settings.apiToken).toBe('old-api-token');
		expect(setLocal).not.toHaveBeenCalled();
		expect(removeSynced).not.toHaveBeenCalled();
	});

	it('returns defaults when nothing is stored', async () => {
		const settings = await loadSettings(memoryStore(), memoryStore());
		expect(settings.serverUrl).toBe('');
		expect(settings.apiToken).toBe('');
		expect(settings.defaultLinkTag).toBe('Links');
		expect(settings.defaultClipTag).toBe('Webclip');
		expect(settings.readeckUrl).toBe('');
		expect(settings.readeckToken).toBe('');
	});

	it('round-trips saved settings', async () => {
		const store = memoryStore();
		await saveSettings(store, store, {
			serverUrl: 'https://notes.example.com',
			apiToken: 'tok123',
			defaultLinkTag: 'Bookmarks',
			defaultClipTag: 'Clips',
			readeckUrl: 'https://readeck.example.com',
			readeckToken: 'rd456',
		});
		const settings = await loadSettings(store, store);
		expect(settings.serverUrl).toBe('https://notes.example.com');
		expect(settings.defaultLinkTag).toBe('Bookmarks');
		expect(settings.readeckToken).toBe('rd456');
	});

	it('strips a trailing slash from the server URL on load', async () => {
		const store = memoryStore({ serverUrl: 'https://notes.example.com/' });
		const settings = await loadSettings(store, memoryStore());
		expect(settings.serverUrl).toBe('https://notes.example.com');
	});
});
