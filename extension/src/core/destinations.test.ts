import { describe, it, expect, vi } from 'vitest';
import { availableDestinations, readeckDestination } from './destinations';
import { DEFAULT_SETTINGS } from './settings';

const readeckSettings = {
	...DEFAULT_SETTINGS,
	readeckUrl: 'https://readeck.example.com',
	readeckToken: 'rd456',
};

describe('readeckDestination', () => {
	it('saves a page via POST /api/bookmarks with bearer auth', async () => {
		const fetch = vi.fn(async () => new Response('{}', { status: 202 }));

		await readeckDestination.save(
			{ url: 'https://example.com/a', title: 'Example', labels: ['Links'] },
			readeckSettings,
			fetch,
		);

		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://readeck.example.com/api/bookmarks');
		expect(init.method).toBe('POST');
		expect(new Headers(init.headers).get('Authorization')).toBe('Bearer rd456');
		expect(JSON.parse(init.body as string)).toEqual({
			url: 'https://example.com/a',
			title: 'Example',
			labels: ['Links'],
		});
	});

	it('throws on a non-2xx response', async () => {
		const fetch = vi.fn(async () => new Response('{}', { status: 401 }));
		await expect(
			readeckDestination.save({ url: 'u', title: 't', labels: [] }, readeckSettings, fetch),
		).rejects.toThrow(/401/);
	});
});

describe('availableDestinations', () => {
	it('includes Readeck only when both URL and token are configured', () => {
		expect(availableDestinations(DEFAULT_SETTINGS)).toEqual([]);
		expect(availableDestinations(readeckSettings).map((d) => d.id)).toEqual(['readeck']);
	});
});
