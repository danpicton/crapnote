import { describe, it, expect } from 'vitest';
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
