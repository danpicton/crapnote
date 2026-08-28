import type { CrapNoteClient, Note } from './crapnote';
import type { NoteDraft } from './note';
import { resolveTags } from './tags';

// Tags are resolved before the note is created so a tag failure leaves no
// half-saved note behind; `existing` lets a retry reuse the note from a
// previous attempt that failed after creation (tag attach is idempotent
// server-side).
export async function saveNote(
	client: CrapNoteClient,
	draft: NoteDraft,
	tagNames: string[],
	existing?: Note,
	onCreated?: (note: Note) => void,
): Promise<Note> {
	const tagIDs = await resolveTags(client, tagNames);
	let note = existing;
	if (!note) {
		note = await client.createNote(draft.title, draft.body);
		// Report immediately so a caller retrying after a later failure
		// (e.g. tag attach) can pass the note back as `existing`.
		onCreated?.(note);
	} else if (existing && (existing.title !== draft.title || existing.body !== draft.body)) {
		// The user may have edited the form between attempts — a retry
		// must not silently keep the stale content.
		note = await client.updateNote(existing.id, draft.title, draft.body);
	}
	for (const id of tagIDs) {
		await client.attachTag(note.id, id);
	}
	return note;
}
