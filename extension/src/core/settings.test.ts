import { describe, it, expect } from 'vitest';
import { loadSettings, saveSettings } from './settings';
import { memoryStore } from './storage';

describe('settings', () => {
	it('returns defaults when nothing is stored', async () => {
		const settings = await loadSettings(memoryStore());
		expect(settings.serverUrl).toBe('');
		expect(settings.apiToken).toBe('');
		expect(settings.defaultLinkTag).toBe('Links');
		expect(settings.defaultClipTag).toBe('Webclip');
		expect(settings.readeckUrl).toBe('');
		expect(settings.readeckToken).toBe('');
	});

	it('round-trips saved settings', async () => {
		const store = memoryStore();
		await saveSettings(store, {
			serverUrl: 'https://notes.example.com',
			apiToken: 'tok123',
			defaultLinkTag: 'Bookmarks',
			defaultClipTag: 'Clips',
			readeckUrl: 'https://readeck.example.com',
			readeckToken: 'rd456',
		});
		const settings = await loadSettings(store);
		expect(settings.serverUrl).toBe('https://notes.example.com');
		expect(settings.defaultLinkTag).toBe('Bookmarks');
		expect(settings.readeckToken).toBe('rd456');
	});

	it('strips a trailing slash from the server URL on load', async () => {
		const store = memoryStore({ serverUrl: 'https://notes.example.com/' });
		const settings = await loadSettings(store);
		expect(settings.serverUrl).toBe('https://notes.example.com');
	});
});
