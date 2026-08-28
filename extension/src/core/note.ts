export interface NoteDraft {
	title: string;
	body: string;
}

export function buildLinkNote(input: { title: string; url: string; description: string }): NoteDraft {
	const title = input.title.trim() || input.url;
	const description = input.description.trim();
	const link = `[${title}](${input.url})`;
	return { title, body: description ? `${link}\n\n${description}` : link };
}

export function buildClipNote(input: { title: string; url: string; content: string }): NoteDraft {
	const title = input.title.trim() || input.url;
	const content = input.content.trim();
	const source = `Clipped from [${title}](${input.url})`;
	return { title, body: content ? `${source}\n\n${content}` : source };
}
