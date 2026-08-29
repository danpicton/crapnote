import { describe, it, expect, vi, afterEach } from 'vitest';
import { inlineClipImages, summarizeImageFailures, type ClipImageCache } from './images';
import { ApiError } from './crapnote';

describe('inlineClipImages', () => {
	const deps = () => ({
		fetchBlob: vi.fn(async () => new Blob(['bytes'], { type: 'image/png' })),
		upload: vi.fn(async () => '/api/images/up-1'),
		// Retries must not spend real time in tests that don't drive a clock.
		sleep: vi.fn(async () => {}),
	});

	it('replaces each mask with a markdown image of the uploaded copy, in order', async () => {
		const d = deps();
		d.upload.mockResolvedValueOnce('/api/images/up-1').mockResolvedValueOnce('/api/images/up-2');

		const clip = await inlineClipImages(
			'Before <image content> mid <image content> after',
			['https://x/a.png', 'https://x/b.png'],
			d,
		);

		expect(clip.content).toBe('Before ![](/api/images/up-1) mid ![](/api/images/up-2) after');
		expect(clip.failures).toEqual([]);
		expect(clip.total).toBe(2);
		expect(d.fetchBlob).toHaveBeenCalledWith('https://x/a.png');
		expect(d.fetchBlob).toHaveBeenCalledWith('https://x/b.png');
	});

	it('falls back to the original image URL when fetch or upload fails, and reports it', async () => {
		const d = deps();
		d.upload.mockRejectedValue(new Error('upload down'));

		const clip = await inlineClipImages('See <image content>', ['https://x/pic.jpg'], d);

		expect(clip.content).toBe('See ![](https://x/pic.jpg)');
		expect(clip.failures).toEqual([
			{ source: 'https://x/pic.jpg', kind: 'transient', message: 'upload down' },
		]);
	});

	it('reports a source it could not download without retrying the download', async () => {
		const d = deps();
		d.fetchBlob.mockRejectedValue(new Error('image fetch failed: 404'));

		const clip = await inlineClipImages('See <image content>', ['https://x/gone.png'], d);

		expect(clip.content).toBe('See ![](https://x/gone.png)');
		expect(clip.failures[0]?.kind).toBe('transient');
		expect(d.fetchBlob).toHaveBeenCalledTimes(1);
		expect(d.upload).not.toHaveBeenCalled();
	});

	it('leaves the mask in place for an empty source and never fetches it', async () => {
		const d = deps();
		const clip = await inlineClipImages(
			'<image content> then <image content>',
			['', 'https://x/b.png'],
			d,
		);
		expect(clip.content).toBe('<image content> then ![](/api/images/up-1)');
		expect(d.fetchBlob).toHaveBeenCalledTimes(1);
		expect(d.fetchBlob).toHaveBeenCalledWith('https://x/b.png');
	});

	it('reuses cached uploads on retry instead of re-uploading', async () => {
		const d = deps();
		const cache: ClipImageCache = new Map();

		await inlineClipImages('<image content>', ['https://x/a.png'], d, cache);
		const clip = await inlineClipImages('<image content>', ['https://x/a.png'], d, cache);

		expect(clip.content).toBe('![](/api/images/up-1)');
		expect(d.upload).toHaveBeenCalledTimes(1);
		expect(d.fetchBlob).toHaveBeenCalledTimes(1);
	});

	it('does not cache a transient failure, so the next attempt uploads that source', async () => {
		const d = deps();
		// Every attempt of the first save is rate-limited; the second save
		// finds a refilled bucket.
		d.upload.mockRejectedValue(new ApiError(429, 'rate limited'));
		const cache: ClipImageCache = new Map();

		const first = await inlineClipImages('<image content>', ['https://x/a.png'], d, cache);
		expect(first.content).toBe('![](https://x/a.png)');
		expect(cache.size).toBe(0);

		d.upload.mockReset().mockResolvedValue('/api/images/up-late');
		const second = await inlineClipImages('<image content>', ['https://x/a.png'], d, cache);

		expect(second.content).toBe('![](/api/images/up-late)');
		expect(second.failures).toEqual([]);
	});

	it('retries a transient failure, honouring Retry-After up to a cap', async () => {
		const d = deps();
		d.upload
			.mockRejectedValueOnce(new ApiError(429, 'rate limited', 60_000))
			.mockResolvedValue('/api/images/up-2nd');

		const clip = await inlineClipImages('<image content>', ['https://x/a.png'], d);

		expect(clip.content).toBe('![](/api/images/up-2nd)');
		expect(d.upload).toHaveBeenCalledTimes(2);
		expect(d.sleep).toHaveBeenCalledWith(30_000);
	});

	it('never retries an unsupported format, and keeps reporting it on later attempts', async () => {
		const d = deps();
		// Every SVG: the server only accepts jpeg/png/gif/webp.
		d.upload.mockRejectedValue(new ApiError(415, 'CrapNote API POST /api/images failed: 415'));
		const cache: ClipImageCache = new Map();

		const first = await inlineClipImages('<image content>', ['https://x/logo.svg'], d, cache);
		expect(first.content).toBe('![](https://x/logo.svg)');
		expect(first.failures).toEqual([
			{
				source: 'https://x/logo.svg',
				kind: 'unsupported',
				message: 'CrapNote API POST /api/images failed: 415',
			},
		]);
		expect(d.upload).toHaveBeenCalledTimes(1);
		expect(d.sleep).not.toHaveBeenCalled();

		const second = await inlineClipImages('<image content>', ['https://x/logo.svg'], d, cache);
		expect(d.upload).toHaveBeenCalledTimes(1);
		expect(second.failures[0]?.kind).toBe('unsupported');
	});

	it('treats a full image quota as permanent too', async () => {
		const d = deps();
		d.upload.mockRejectedValue(new ApiError(507, 'storage quota exceeded'));

		const clip = await inlineClipImages('<image content>', ['https://x/a.png'], d);

		expect(clip.failures[0]?.kind).toBe('quota');
		expect(d.upload).toHaveBeenCalledTimes(1);
	});

	it('never retries a request the server refused outright, and caches it', async () => {
		const d = deps();
		// An oversized image: the handler's MaxBytesReader turns it into a
		// 400, which no number of further uploads will change.
		d.upload.mockRejectedValue(new ApiError(400, 'image too large or bad request'));
		const cache: ClipImageCache = new Map();

		const first = await inlineClipImages('<image content>', ['https://x/huge.png'], d, cache);

		expect(first.content).toBe('![](https://x/huge.png)');
		expect(first.failures[0]?.kind).toBe('rejected');
		expect(d.upload).toHaveBeenCalledTimes(1);
		expect(d.sleep).not.toHaveBeenCalled();

		await inlineClipImages('<image content>', ['https://x/huge.png'], d, cache);
		expect(d.upload).toHaveBeenCalledTimes(1);
	});

	it('still retries a server error', async () => {
		const d = deps();
		d.upload.mockRejectedValueOnce(new ApiError(503, 'bad gateway')).mockResolvedValue('/api/images/up-2nd');

		const clip = await inlineClipImages('<image content>', ['https://x/a.png'], d);

		expect(clip.content).toBe('![](/api/images/up-2nd)');
		expect(d.sleep).toHaveBeenCalledWith(6_000);
	});

	it('keeps a floor under Retry-After so a zero delay cannot burn the budget', async () => {
		const d = deps();
		// A proxy in front of CrapNote answering "retry immediately".
		d.upload.mockRejectedValueOnce(new ApiError(429, 'slow down', 0)).mockResolvedValue('/api/images/up-2nd');

		await inlineClipImages('<image content>', ['https://x/a.png'], d);

		expect(d.sleep).toHaveBeenCalledWith(1_000);
	});

	it('uploads at most four images at a time', async () => {
		let inFlight = 0;
		let peak = 0;
		const d = {
			fetchBlob: vi.fn(async () => new Blob(['bytes'], { type: 'image/png' })),
			upload: vi.fn(async () => {
				peak = Math.max(peak, ++inFlight);
				await Promise.resolve();
				inFlight--;
				return '/api/images/up';
			}),
			sleep: vi.fn(async () => {}),
		};
		const sources = Array.from({ length: 25 }, (_, i) => `https://x/${i}.png`);

		await inlineClipImages(sources.map(() => '<image content>').join(' '), sources, d);

		expect(d.upload).toHaveBeenCalledTimes(25);
		expect(peak).toBeGreaterThan(1);
		expect(peak).toBeLessThanOrEqual(4);
	});

	it('reports upload progress as sources settle', async () => {
		const d = { ...deps(), onProgress: vi.fn() };
		const sources = ['https://x/a.png', 'https://x/b.png'];

		await inlineClipImages('<image content> <image content 2>', sources, d);

		expect(d.onProgress).toHaveBeenCalledWith(0, 2);
		expect(d.onProgress).toHaveBeenLastCalledWith(2, 2);
	});

	it('pairs numbered masks with their source by index, surviving deletion of another mask', async () => {
		const d = deps();
		d.upload.mockResolvedValue('/api/images/up-b');

		// The clip had two images; the user deleted mask 1 from the textarea.
		const clip = await inlineClipImages(
			'Only: <image content 2>',
			['https://x/a.png', 'https://x/b.png'],
			d,
		);

		expect(clip.content).toBe('Only: ![](/api/images/up-b)');
		expect(d.fetchBlob).toHaveBeenCalledTimes(1);
		expect(d.fetchBlob).toHaveBeenCalledWith('https://x/b.png');
	});

	it('leaves surplus masks untouched and ignores surplus sources', async () => {
		const d = deps();
		const clip = await inlineClipImages(
			'<image content> and <image content>',
			['https://x/only.png'],
			d,
		);
		expect(clip.content).toBe('![](/api/images/up-1) and <image content>');
	});
});

// Mirrors backend/internal/ratelimit: a token bucket keyed per user, built
// by the images handler as ratelimit.New(10/60, 10) — burst 10, one token
// back every 6 seconds.
function tokenBucket(tokensPerSecond: number, burst: number): () => boolean {
	let tokens = burst;
	let last = Date.now();
	return () => {
		const now = Date.now();
		tokens = Math.min(burst, tokens + ((now - last) / 1000) * tokensPerSecond);
		last = now;
		if (tokens < 1) return false;
		tokens -= 1;
		return true;
	};
}

describe('inlineClipImages against the server rate limit', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('stores every image of a 25-image clip, riding out the 429s', async () => {
		vi.useFakeTimers();
		const allow = tokenBucket(10 / 60, 10);
		let peak = 0;
		let inFlight = 0;
		let uploaded = 0;
		let rejected = 0;
		const d = {
			fetchBlob: vi.fn(async () => new Blob(['bytes'], { type: 'image/png' })),
			upload: vi.fn(async () => {
				peak = Math.max(peak, ++inFlight);
				try {
					if (!allow()) {
						// What the handler sends: 429 plus Retry-After: 60.
						rejected++;
						throw new ApiError(429, 'upload rate limit exceeded', 60_000);
					}
					return `/api/images/stored-${++uploaded}`;
				} finally {
					inFlight--;
				}
			}),
		};
		const sources = Array.from({ length: 25 }, (_, i) => `https://x/${i}.png`);
		const content = sources.map((_, i) => `<image content ${i + 1}>`).join('\n');

		const pending = inlineClipImages(content, sources, d);
		await vi.advanceTimersByTimeAsync(5 * 60_000);
		const clip = await pending;

		// The burst of 10 is spent long before the 25th image, so this only
		// proves anything if the limit actually bit.
		expect(rejected).toBeGreaterThan(0);
		expect(uploaded).toBe(25);
		expect(clip.failures).toEqual([]);
		expect(clip.content).not.toContain('https://x/');
		expect(peak).toBeLessThanOrEqual(4);
	});
});

describe('summarizeImageFailures', () => {
	it('counts retryable and permanent failures separately', () => {
		const message = summarizeImageFailures({
			content: '',
			total: 12,
			failures: [
				{ source: 'a', kind: 'transient', message: 'boom' },
				{ source: 'b', kind: 'unsupported', message: '415' },
				{ source: 'c', kind: 'unsupported', message: '415' },
				{ source: 'd', kind: 'rejected', message: '400' },
			],
		});

		expect(message).toBe(
			'Saved, but 4 of 12 images still link to the original site: ' +
				'1 could not be uploaded, 2 in a format CrapNote cannot store, 1 refused by the server. ' +
				'Save again to retry them.',
		);
	});

	it('does not offer a retry when every failure is permanent', () => {
		const message = summarizeImageFailures({
			content: '',
			total: 2,
			failures: [{ source: 'a', kind: 'quota', message: '507' }],
		});

		expect(message).toBe(
			'Saved, but 1 of 2 images still link to the original site: 1 over your image quota.',
		);
	});
});
