import { describe, it, expect, vi, beforeEach } from 'vitest';
// @ts-expect-error vite ?raw import
import html from './popup.html?raw';
import { initPopup, type PopupDeps } from './controller';
import { DEFAULT_SETTINGS } from '../core/settings';
import type { CrapNoteClient, Tag } from '../core/crapnote';
import { readeckDestination } from '../core/destinations';

function clientStub(tags: Tag[] = [{ id: 1, name: 'Links' }]) {
	return {
		createNote: vi.fn(async (title: string, body: string) => ({ id: 42, title, body })),
		listTags: vi.fn(async () => tags),
		createTag: vi.fn(async (name: string) => ({ id: 100, name })),
		attachTag: vi.fn(async () => {}),
		uploadImage: vi.fn(async () => '/api/images/up-1'),
	} as unknown as CrapNoteClient;
}

function deps(overrides: Partial<PopupDeps> = {}): PopupDeps {
	return {
		settings: { ...DEFAULT_SETTINGS, serverUrl: 'https://n.example.com', apiToken: 'tok' },
		client: clientStub(),
		context: { mode: 'link', url: 'https://example.com/a', title: 'Example Page' },
		destinations: [],
		close: vi.fn(),
		openOptions: vi.fn(),
		fetchBlob: vi.fn(async () => new Blob(['img'], { type: 'image/png' })),
		...overrides,
	};
}

beforeEach(() => {
	document.documentElement.innerHTML = (html as string)
		.replace(/<link[^>]*>/, '')
		.replace(/<script[^>]*><\/script>/, '');
});

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

describe('popup in link mode', () => {
	it('shows the page URL, prefills title and default link tag, and offers existing tags', async () => {
		const d = deps();
		await initPopup(document, d);

		expect(el<HTMLOutputElement>('url').textContent).toBe('https://example.com/a');
		expect(el<HTMLInputElement>('title').value).toBe('Example Page');
		expect(el<HTMLInputElement>('tags').value).toBe('Links');
		const options = Array.from(document.querySelectorAll('#tag-options option'));
		expect(options.map((o) => o.getAttribute('value'))).toEqual(['Links']);
	});

	it('saves a note built from the form and closes the popup', async () => {
		const d = deps();
		await initPopup(document, d);

		el<HTMLTextAreaElement>('content').value = 'A description';
		el<HTMLInputElement>('tags').value = 'Links, extra';
		el<HTMLFormElement>('save-form').dispatchEvent(new Event('submit'));
		await vi.waitFor(() => expect(d.close).toHaveBeenCalled());

		expect(d.client.createNote).toHaveBeenCalledWith(
			'Example Page',
			'[Example Page](https://example.com/a)\n\n&nbsp;\n\nA description',
		);
		expect(d.client.attachTag).toHaveBeenCalledWith(42, 1);
		expect(d.client.attachTag).toHaveBeenCalledWith(42, 100);
	});

	it('offers configured destinations and saves the page to those checked, without the default link tag', async () => {
		const save = vi.spyOn(readeckDestination, 'save').mockResolvedValue();
		const d = deps({ destinations: [readeckDestination] });
		await initPopup(document, d);

		const checkbox = document.querySelector<HTMLInputElement>(
			'#destination-rows input[type=checkbox]',
		);
		expect(checkbox).not.toBeNull();
		expect(document.getElementById('destination-rows')?.textContent).toContain('Readeck');

		el<HTMLInputElement>('tags').value = 'links, research';
		checkbox!.checked = true;
		el<HTMLFormElement>('save-form').dispatchEvent(new Event('submit'));
		await vi.waitFor(() => expect(d.close).toHaveBeenCalled());

		expect(save).toHaveBeenCalledWith(
			{ url: 'https://example.com/a', title: 'Example Page', labels: ['research'] },
			d.settings,
		);
		save.mockRestore();
	});

	it('suggests completions that keep the tags already entered', async () => {
		const d = deps({
			client: clientStub([
				{ id: 1, name: 'Links' },
				{ id: 3, name: 'Webclip' },
			]),
		});
		await initPopup(document, d);

		const tags = el<HTMLInputElement>('tags');
		tags.value = 'Links, We';
		tags.dispatchEvent(new Event('input'));

		const options = Array.from(document.querySelectorAll('#tag-options option')).map((o) =>
			o.getAttribute('value'),
		);
		expect(options).toEqual(['Links, Webclip']);
	});

	it('retries without creating a duplicate note when a step after creation fails', async () => {
		const d = deps();
		(d.client.attachTag as ReturnType<typeof vi.fn>)
			.mockRejectedValueOnce(new Error('attach failed'))
			.mockResolvedValue(undefined);
		await initPopup(document, d);

		const form = el<HTMLFormElement>('save-form');
		form.dispatchEvent(new Event('submit'));
		await vi.waitFor(() => expect(el('status').textContent).toContain('attach failed'));

		form.dispatchEvent(new Event('submit'));
		await vi.waitFor(() => expect(d.close).toHaveBeenCalled());

		expect(d.client.createNote).toHaveBeenCalledTimes(1);
	});

	it('disables saving and points at options when unconfigured', async () => {
		const d = deps({ settings: { ...DEFAULT_SETTINGS } });
		await initPopup(document, d);

		expect(el('unconfigured').hidden).toBe(false);
		expect(el<HTMLButtonElement>('save').disabled).toBe(true);
	});
});

describe('popup in clip mode', () => {
	it('prefills clipped content and the default clip tag, and offers no destinations', async () => {
		const d = deps({
			context: {
				mode: 'clip',
				url: 'https://example.com/a',
				title: 'Example Page',
				content: 'Clipped words <image content>',
			},
			destinations: [readeckDestination],
		});
		await initPopup(document, d);

		expect(el<HTMLTextAreaElement>('content').value).toBe('Clipped words <image content>');
		expect(el<HTMLInputElement>('tags').value).toBe('Webclip');
		expect(el('content-label').textContent).toBe('Content');
		expect(el('heading').textContent).toBe('Save web clip');
		expect(document.querySelector('#destination-rows input')).toBeNull();
	});

	it('substitutes masks with uploaded images on save', async () => {
		const d = deps({
			context: {
				mode: 'clip',
				url: 'https://example.com/a',
				title: 'Example Page',
				content: 'Look: <image content>',
				images: ['https://example.com/pic.jpg'],
			},
		});
		(d.client.uploadImage as ReturnType<typeof vi.fn>).mockResolvedValue('/api/images/up-9');
		await initPopup(document, d);

		el<HTMLFormElement>('save-form').dispatchEvent(new Event('submit'));
		await vi.waitFor(() => expect(d.close).toHaveBeenCalled());

		expect(d.fetchBlob).toHaveBeenCalledWith('https://example.com/pic.jpg');
		expect(d.client.createNote).toHaveBeenCalledWith(
			'Example Page',
			'Clipped from [Example Page](https://example.com/a)\n\n&nbsp;\n\nLook: ![](/api/images/up-9)',
		);
	});

	it('saves the clip note with the source line above the content', async () => {
		const d = deps({
			context: { mode: 'clip', url: 'https://example.com/a', title: 'Example Page', content: 'Words' },
		});
		await initPopup(document, d);

		el<HTMLFormElement>('save-form').dispatchEvent(new Event('submit'));
		await vi.waitFor(() => expect(d.close).toHaveBeenCalled());

		expect(d.client.createNote).toHaveBeenCalledWith(
			'Example Page',
			'Clipped from [Example Page](https://example.com/a)\n\n&nbsp;\n\nWords',
		);
	});
});
