import { describe, it, expect, vi, beforeEach } from 'vitest';
// @ts-expect-error vite ?raw import
import html from './popup.html?raw';
import { initPopup, type PopupDeps } from './controller';
import { DEFAULT_SETTINGS } from '../core/settings';
import { ApiError, type CrapNoteClient, type Tag } from '../core/crapnote';
import { readeckDestination } from '../core/destinations';

function clientStub(tags: Tag[] = [{ id: 1, name: 'Links' }]) {
	return {
		createNote: vi.fn(async (title: string, body: string) => ({ id: 42, title, body })),
		listTags: vi.fn(async () => tags),
		createTag: vi.fn(async (name: string) => ({ id: 100, name })),
		attachTag: vi.fn(async () => {}),
		uploadImage: vi.fn(async () => '/api/images/up-1'),
		updateNote: vi.fn(async (id: number, title: string, body: string) => ({ id, title, body })),
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

	it('saves the note with hot-links first, then folds in each stored image', async () => {
		const d = deps({
			context: {
				mode: 'clip',
				url: 'https://example.com/a',
				title: 'Example Page',
				content: 'Look: <image content>',
				images: ['https://example.com/pic.jpg'],
			},
		});
		const order: string[] = [];
		(d.client.createNote as ReturnType<typeof vi.fn>).mockImplementation(
			async (title: string, body: string) => {
				order.push('createNote');
				return { id: 42, title, body };
			},
		);
		(d.client.uploadImage as ReturnType<typeof vi.fn>).mockImplementation(async () => {
			order.push('uploadImage');
			return '/api/images/up-9';
		});
		await initPopup(document, d);

		el<HTMLFormElement>('save-form').dispatchEvent(new Event('submit'));
		await vi.waitFor(() => expect(d.close).toHaveBeenCalled());

		// The note exists before any image bytes are stored, so a popup
		// destroyed mid-upload can never strand an image with nothing
		// referencing it.
		expect(order).toEqual(['createNote', 'uploadImage']);
		expect(d.fetchBlob).toHaveBeenCalledWith('https://example.com/pic.jpg');
		expect(d.client.createNote).toHaveBeenCalledWith(
			'Example Page',
			'Clipped from [Example Page](https://example.com/a)\n\n&nbsp;\n\nLook: ![](https://example.com/pic.jpg)',
		);
		expect(d.client.updateNote).toHaveBeenCalledWith(
			42,
			'Example Page',
			'Clipped from [Example Page](https://example.com/a)\n\n&nbsp;\n\nLook: ![](/api/images/up-9)',
		);
	});

	it('keeps an image that stored before a later one failed referenced by the note', async () => {
		const d = deps({
			context: {
				mode: 'clip',
				url: 'https://example.com/a',
				title: 'Example Page',
				content: 'One <image content 1> two <image content 2>',
				images: ['https://example.com/a.png', 'https://example.com/logo.svg'],
			},
		});
		const upload = d.client.uploadImage as ReturnType<typeof vi.fn>;
		upload.mockImplementation(async (blob: Blob) => {
			if (await blob.text() === 'svg') throw new ApiError(415, 'not an image');
			return '/api/images/up-a';
		});
		(d.fetchBlob as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) =>
			url.endsWith('.svg') ? new Blob(['svg']) : new Blob(['png']),
		);
		await initPopup(document, d);

		el<HTMLFormElement>('save-form').dispatchEvent(new Event('submit'));
		await vi.waitFor(() =>
			expect(el('status').textContent).toContain('still link to the original site'),
		);

		expect(d.client.updateNote).toHaveBeenLastCalledWith(
			42,
			'Example Page',
			'Clipped from [Example Page](https://example.com/a)\n\n&nbsp;\n\n' +
				'One ![](/api/images/up-a) two ![](https://example.com/logo.svg)',
		);
	});

	it('coalesces the note updates instead of writing once per image', async () => {
		const images = Array.from({ length: 6 }, (_, i) => `https://example.com/${i}.png`);
		const d = deps({
			context: {
				mode: 'clip',
				url: 'https://example.com/a',
				title: 'Example Page',
				content: images.map((_, i) => `<image content ${i + 1}>`).join(' '),
				images,
			},
		});
		let n = 0;
		(d.client.uploadImage as ReturnType<typeof vi.fn>).mockImplementation(
			async () => `/api/images/up-${n++}`,
		);
		// Hold the first note update open until every image has landed, so
		// all six completions arrive while a write is in flight.
		let release = (): void => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const updateNote = d.client.updateNote as ReturnType<typeof vi.fn>;
		updateNote.mockImplementation(async (id: number, title: string, body: string) => {
			if (updateNote.mock.calls.length === 1) await held;
			return { id, title, body };
		});
		await initPopup(document, d);

		el<HTMLFormElement>('save-form').dispatchEvent(new Event('submit'));
		await vi.waitFor(() => expect(d.client.uploadImage).toHaveBeenCalledTimes(images.length));
		release();
		await vi.waitFor(() => expect(d.close).toHaveBeenCalled());

		// The held write plus a single catch-up carrying everything that
		// landed meanwhile — not one write per image.
		expect(updateNote).toHaveBeenCalledTimes(2);
		const finalBody = updateNote.mock.calls[1]?.[2] as string;
		for (let i = 0; i < images.length; i++) {
			expect(finalBody).toContain(`![](/api/images/up-${i})`);
		}
	});

	it('keeps the page title in the source link when the note title is edited', async () => {
		const d = deps({
			context: { mode: 'clip', url: 'https://example.com/a', title: 'Example Page', content: 'Words' },
		});
		await initPopup(document, d);

		el<HTMLInputElement>('title').value = 'My own title';
		el<HTMLFormElement>('save-form').dispatchEvent(new Event('submit'));
		await vi.waitFor(() => expect(d.close).toHaveBeenCalled());

		expect(d.client.createNote).toHaveBeenCalledWith(
			'My own title',
			'Clipped from [Example Page](https://example.com/a)\n\n&nbsp;\n\nWords',
		);
	});

	it('does not re-upload images when retrying after a failure', async () => {
		const d = deps({
			context: {
				mode: 'clip',
				url: 'https://example.com/a',
				title: 'Example Page',
				content: 'Look: <image content>',
				images: ['https://example.com/pic.jpg'],
			},
		});
		(d.client.attachTag as ReturnType<typeof vi.fn>)
			.mockRejectedValueOnce(new Error('attach failed'))
			.mockResolvedValue(undefined);
		await initPopup(document, d);

		const form = el<HTMLFormElement>('save-form');
		el<HTMLInputElement>('tags').value = 'Links';
		form.dispatchEvent(new Event('submit'));
		await vi.waitFor(() => expect(el('status').textContent).toContain('attach failed'));
		form.dispatchEvent(new Event('submit'));
		await vi.waitFor(() => expect(d.close).toHaveBeenCalled());

		expect(d.client.uploadImage).toHaveBeenCalledTimes(1);
	});

	it('reports images it could not store instead of closing as if all was well', async () => {
		const d = deps({
			context: {
				mode: 'clip',
				url: 'https://example.com/a',
				title: 'Example Page',
				content: 'Logo: <image content>',
				images: ['https://example.com/logo.svg'],
			},
		});
		// The server accepts only jpeg/png/gif/webp, so an SVG is a 415.
		(d.client.uploadImage as ReturnType<typeof vi.fn>).mockRejectedValue(
			new ApiError(415, 'CrapNote API POST /api/images failed: 415'),
		);
		await initPopup(document, d);

		el<HTMLFormElement>('save-form').dispatchEvent(new Event('submit'));
		await vi.waitFor(() => expect(d.client.createNote).toHaveBeenCalled());

		expect(el('status').textContent).toBe(
			'Saved, but 1 of 1 images still link to the original site: ' +
				'1 in a format CrapNote cannot store.',
		);
		expect(d.close).not.toHaveBeenCalled();
		// Nothing retryable failed, so saving again would only redo the whole
		// save and still never close — the button stays off.
		expect(el<HTMLButtonElement>('save').disabled).toBe(true);
		// The note is still saved — with the image hot-linked.
		expect(d.client.createNote).toHaveBeenCalledWith(
			'Example Page',
			'Clipped from [Example Page](https://example.com/a)\n\n&nbsp;\n\nLogo: ![](https://example.com/logo.svg)',
		);
	});

	it('re-attempts a rate-limited image on the next save and repairs the note', async () => {
		// The backoff waits out the real Retry-After, so drive the clock.
		vi.useFakeTimers();
		try {
			const d = deps({
				context: {
					mode: 'clip',
					url: 'https://example.com/a',
					title: 'Example Page',
					content: 'Look: <image content>',
					images: ['https://example.com/pic.jpg'],
				},
			});
			const upload = d.client.uploadImage as ReturnType<typeof vi.fn>;
			// Every attempt of the first save is refused, as against a
			// drained token bucket; the next save finds a refilled one.
			let call = 0;
			upload.mockImplementation(async () => {
				if (++call <= 5) throw new ApiError(429, 'upload rate limit exceeded', 60_000);
				return '/api/images/up-late';
			});
			await initPopup(document, d);

			const form = el<HTMLFormElement>('save-form');
			form.dispatchEvent(new Event('submit'));
			await vi.advanceTimersByTimeAsync(4 * 30_000);
			await vi.waitFor(() =>
				expect(el('status').textContent).toContain('still link to the original site'),
			);
			expect(el('status').textContent).toContain('Save again to retry them.');
			expect(el<HTMLButtonElement>('save').disabled).toBe(false);

			form.dispatchEvent(new Event('submit'));
			await vi.waitFor(() => expect(d.close).toHaveBeenCalled());

			// The failure was never cached, so the retry uploaded it and the
			// existing note was updated to point at the stored copy.
			expect(d.client.updateNote).toHaveBeenCalledWith(
				42,
				'Example Page',
				'Clipped from [Example Page](https://example.com/a)\n\n&nbsp;\n\nLook: ![](/api/images/up-late)',
			);
		} finally {
			vi.useRealTimers();
		}
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
