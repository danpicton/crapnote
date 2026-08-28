import { describe, it, expect, vi } from 'vitest';
import { parseTagInput, resolveTags } from './tags';
import type { CrapNoteClient, Tag } from './crapnote';

describe('parseTagInput', () => {
	it('splits comma-separated tags and trims whitespace, dropping empties', () => {
		expect(parseTagInput(' Links, go ,  , web dev ')).toEqual(['Links', 'go', 'web dev']);
		expect(parseTagInput('')).toEqual([]);
	});

	it('deduplicates case-insensitively, keeping first spelling', () => {
		expect(parseTagInput('Links, links, LINKS, go')).toEqual(['Links', 'go']);
	});
});

describe('resolveTags', () => {
	function clientStub(existing: Tag[]) {
		let nextID = 100;
		return {
			listTags: vi.fn(async () => existing),
			createTag: vi.fn(async (name: string) => ({ id: nextID++, name })),
		} as unknown as CrapNoteClient;
	}

	it('matches existing tags case-insensitively and creates only missing ones', async () => {
		const client = clientStub([{ id: 1, name: 'Links' }, { id: 2, name: 'go' }]);

		const ids = await resolveTags(client, ['links', 'GO', 'brand-new']);

		expect(ids).toEqual([1, 2, 100]);
		expect(client.createTag).toHaveBeenCalledTimes(1);
		expect(client.createTag).toHaveBeenCalledWith('brand-new');
	});
});
