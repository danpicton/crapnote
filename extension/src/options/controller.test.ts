import { describe, it, expect, beforeEach } from 'vitest';
// @ts-expect-error vite ?raw import
import html from './options.html?raw';
import { initOptions } from './controller';
import { loadSettings } from '../core/settings';
import { memoryStore } from '../core/storage';

beforeEach(() => {
	document.documentElement.innerHTML = (html as string)
		.replace(/<link[^>]*>/, '')
		.replace(/<script[^>]*><\/script>/, '');
});

const input = (id: string) => document.getElementById(id) as HTMLInputElement;

describe('options page', () => {
	it('prefills the form with stored settings and defaults', async () => {
		const store = memoryStore({ serverUrl: 'https://n.example.com' });
		await initOptions(document, store);

		expect(input('server-url').value).toBe('https://n.example.com');
		expect(input('default-link-tag').value).toBe('Links');
		expect(input('default-clip-tag').value).toBe('Webclip');
	});

	it('persists edited settings on submit', async () => {
		const store = memoryStore();
		await initOptions(document, store);

		input('server-url').value = 'https://n.example.com/';
		input('api-token').value = 'tok';
		input('default-link-tag').value = 'Bookmarks';
		input('readeck-url').value = 'https://rd.example.com';
		input('readeck-token').value = 'rd';
		document.getElementById('options-form')!.dispatchEvent(new Event('submit'));
		await new Promise((r) => setTimeout(r));

		const saved = await loadSettings(store);
		expect(saved.serverUrl).toBe('https://n.example.com');
		expect(saved.apiToken).toBe('tok');
		expect(saved.defaultLinkTag).toBe('Bookmarks');
		expect(saved.defaultClipTag).toBe('Webclip');
		expect(saved.readeckUrl).toBe('https://rd.example.com');
		expect(saved.readeckToken).toBe('rd');
	});
});
