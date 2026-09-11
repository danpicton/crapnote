import { describe, it, expect, beforeEach } from 'vitest';
// @ts-expect-error vite ?raw import
import html from './options.html?raw';
import { initOptions } from './controller';
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
		await initOptions(document, store, memoryStore());

		expect(input('server-url').value).toBe('https://n.example.com');
		expect(input('default-link-tag').value).toBe('Links');
		expect(input('default-clip-tag').value).toBe('Webclip');
	});

	it('persists edited preferences in sync storage and tokens locally', async () => {
		const sync = memoryStore();
		const local = memoryStore();
		await initOptions(document, sync, local);

		input('server-url').value = 'https://n.example.com/';
		input('api-token').value = 'tok';
		input('default-link-tag').value = 'Bookmarks';
		input('readeck-url').value = 'https://rd.example.com';
		input('readeck-token').value = 'rd';
		document.getElementById('options-form')!.dispatchEvent(new Event('submit'));
		await new Promise((r) => setTimeout(r));

		expect(await sync.get(['serverUrl', 'apiToken', 'defaultLinkTag', 'readeckUrl'])).toEqual({
			serverUrl: 'https://n.example.com',
			defaultLinkTag: 'Bookmarks',
			readeckUrl: 'https://rd.example.com',
		});
		expect(await local.get(['apiToken', 'readeckToken'])).toEqual({
			apiToken: 'tok',
			readeckToken: 'rd',
		});
	});
});
