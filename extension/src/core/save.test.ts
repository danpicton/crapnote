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
});
