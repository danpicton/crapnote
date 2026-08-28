import { describe, it, expect, vi } from 'vitest';
import { saveNote } from './save';
import type { CrapNoteClient, Tag } from './crapnote';

function clientStub(existing: Tag[]) {
	return {
		createNote: vi.fn(async (title: string, body: string) => ({ id: 42, title, body })),
		listTags: vi.fn(async () => existing),
		createTag: vi.fn(async (name: string) => ({ id: 100, name })),
		attachTag: vi.fn(async () => {}),
	} as unknown as CrapNoteClient;
}

describe('saveNote', () => {
	it('creates the note then attaches every resolved tag', async () => {
		const client = clientStub([{ id: 1, name: 'Links' }]);

		const note = await saveNote(client, { title: 'T', body: 'B' }, ['Links', 'new']);

		expect(note.id).toBe(42);
		expect(client.createNote).toHaveBeenCalledWith('T', 'B');
		expect(client.attachTag).toHaveBeenCalledWith(42, 1);
		expect(client.attachTag).toHaveBeenCalledWith(42, 100);
	});

	it('resolves tags before creating the note, so tag failures leave nothing behind', async () => {
		const client = clientStub([]);
		(client.listTags as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));

		await expect(saveNote(client, { title: 'T', body: 'B' }, ['x'])).rejects.toThrow('boom');
		expect(client.createNote).not.toHaveBeenCalled();
	});

	it('reuses an already-created note instead of creating a duplicate on retry', async () => {
		const client = clientStub([{ id: 1, name: 'Links' }]);

		const note = await saveNote(client, { title: 'T', body: 'B' }, ['Links'], {
			id: 7,
			title: 'T',
			body: 'B',
		});

		expect(note.id).toBe(7);
		expect(client.createNote).not.toHaveBeenCalled();
		expect(client.attachTag).toHaveBeenCalledWith(7, 1);
	});
});
