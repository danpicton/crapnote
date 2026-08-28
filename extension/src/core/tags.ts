import type { CrapNoteClient } from './crapnote';

// Splits a comma-separated tag input into trimmed, case-insensitively
// deduplicated names (first spelling wins).
export function parseTagInput(input: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of input.split(',')) {
		const name = raw.trim();
		if (!name) continue;
		const key = name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(name);
	}
	return out;
}

// Maps tag names to tag IDs, matching the user's existing tags
// case-insensitively and creating any that don't exist yet. The server's
// POST /api/tags is a plain insert, so creating a duplicate would fail —
// hence the client-side match first.
export async function resolveTags(client: CrapNoteClient, names: string[]): Promise<number[]> {
	if (names.length === 0) return [];
	const existing = await client.listTags();
	const byName = new Map(existing.map((t) => [t.name.toLowerCase(), t.id]));
	const ids: number[] = [];
	for (const name of names) {
		const found = byName.get(name.toLowerCase());
		if (found !== undefined) {
			ids.push(found);
		} else {
			const created = await client.createTag(name);
			byName.set(created.name.toLowerCase(), created.id);
			ids.push(created.id);
		}
	}
	return ids;
}
