import type { CrapNoteClient, Note } from './crapnote';
import type { NoteDraft } from './note';
import { resolveTags } from './tags';

export async function saveNote(
	client: CrapNoteClient,
	draft: NoteDraft,
	tagNames: string[],
): Promise<Note> {
	const note = await client.createNote(draft.title, draft.body);
	const tagIDs = await resolveTags(client, tagNames);
	for (const id of tagIDs) {
		await client.attachTag(note.id, id);
	}
	return note;
}
