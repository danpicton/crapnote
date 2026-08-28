import { describe, it, expect, vi } from 'vitest';
import { inlineClipImages } from './images';

describe('inlineClipImages', () => {
	const deps = () => ({
		fetchBlob: vi.fn(async () => new Blob(['bytes'], { type: 'image/png' })),
		upload: vi.fn(async () => '/api/images/up-1'),
	});

	it('replaces each mask with a markdown image of the uploaded copy, in order', async () => {
		const d = deps();
		d.upload.mockResolvedValueOnce('/api/images/up-1').mockResolvedValueOnce('/api/images/up-2');

		const body = await inlineClipImages(
			'Before <image content> mid <image content> after',
			['https://x/a.png', 'https://x/b.png'],
			d,
		);

		expect(body).toBe('Before ![](/api/images/up-1) mid ![](/api/images/up-2) after');
		expect(d.fetchBlob).toHaveBeenCalledWith('https://x/a.png');
		expect(d.fetchBlob).toHaveBeenCalledWith('https://x/b.png');
	});

	it('falls back to the original image URL when fetch or upload fails', async () => {
		const d = deps();
		d.upload.mockRejectedValue(new Error('upload down'));

		const body = await inlineClipImages('See <image content>', ['https://x/pic.jpg'], d);

		expect(body).toBe('See ![](https://x/pic.jpg)');
	});

	it('leaves the mask in place for an empty source and never fetches it', async () => {
		const d = deps();
		const body = await inlineClipImages('<image content> then <image content>', ['', 'https://x/b.png'], d);
		expect(body).toBe('<image content> then ![](/api/images/up-1)');
		expect(d.fetchBlob).toHaveBeenCalledTimes(1);
		expect(d.fetchBlob).toHaveBeenCalledWith('https://x/b.png');
	});

	it('reuses cached uploads on retry instead of re-uploading', async () => {
		const d = deps();
		const cache = new Map<string, string>();

		await inlineClipImages('<image content>', ['https://x/a.png'], d, cache);
		const body = await inlineClipImages('<image content>', ['https://x/a.png'], d, cache);

		expect(body).toBe('![](/api/images/up-1)');
		expect(d.upload).toHaveBeenCalledTimes(1);
		expect(d.fetchBlob).toHaveBeenCalledTimes(1);
	});

	it('leaves surplus masks untouched and ignores surplus sources', async () => {
		const d = deps();
		const body = await inlineClipImages('<image content> and <image content>', ['https://x/only.png'], d);
		expect(body).toBe('![](/api/images/up-1) and <image content>');
	});
});
