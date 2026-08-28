import { describe, it, expect, vi } from 'vitest';
import { CrapNoteClient } from './crapnote';

function fetchStub(status: number, body: unknown) {
	return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

const config = { serverUrl: 'https://notes.example.com', apiToken: 'tok123' };

describe('CrapNoteClient', () => {
	it('creates a note via POST /api/notes with bearer auth', async () => {
		const fetch = fetchStub(201, { id: 42, title: 'T', body: 'B' });
		const client = new CrapNoteClient(config, fetch);

		const note = await client.createNote('T', 'B');

		expect(note.id).toBe(42);
		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://notes.example.com/api/notes');
		expect(init.method).toBe('POST');
		expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok123');
		expect(JSON.parse(init.body as string)).toEqual({ title: 'T', body: 'B' });
	});

	it('lists tags via GET /api/tags', async () => {
		const fetch = fetchStub(200, [{ id: 1, name: 'Links' }, { id: 2, name: 'go' }]);
		const client = new CrapNoteClient(config, fetch);

		const tags = await client.listTags();

		expect(tags.map((t) => t.name)).toEqual(['Links', 'go']);
		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://notes.example.com/api/tags');
		expect(init.method).toBe('GET');
	});

	it('creates a tag and attaches a tag to a note', async () => {
		const fetch = fetchStub(201, { id: 7, name: 'newtag' });
		const client = new CrapNoteClient(config, fetch);

		const tag = await client.createTag('newtag');
		await client.attachTag(42, tag.id);

		expect(tag.id).toBe(7);
		const [createUrl, createInit] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(createUrl).toBe('https://notes.example.com/api/tags');
		expect(JSON.parse(createInit.body as string)).toEqual({ name: 'newtag' });
		const [attachUrl, attachInit] = fetch.mock.calls[1] as unknown as [string, RequestInit];
		expect(attachUrl).toBe('https://notes.example.com/api/notes/42/tags');
		expect(JSON.parse(attachInit.body as string)).toEqual({ tag_id: 7 });
	});

	it('throws a descriptive error on a non-2xx response', async () => {
		const fetch = fetchStub(401, { error: 'not authenticated' });
		const client = new CrapNoteClient(config, fetch);

		await expect(client.createNote('T', 'B')).rejects.toThrow(/401/);
	});
});
