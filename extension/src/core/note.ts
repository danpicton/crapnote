export interface NoteDraft {
	title: string;
	body: string;
}

// CrapNote's editor renders paragraphs with tight spacing, so a plain
// paragraph break shows no gap; the &nbsp; paragraph is a real empty line.
const EMPTY_LINE = '\n\n&nbsp;\n\n';

export function buildLinkNote(input: { title: string; url: string; description: string }): NoteDraft {
	const title = input.title.trim() || input.url;
	const description = input.description.trim();
	const link = `[${title}](${input.url})`;
	return { title, body: description ? `${link}${EMPTY_LINE}${description}` : link };
}

// The source link always names the page it was clipped from (sourceTitle),
// independent of what the user renames the note to.
export function buildClipNote(input: {
	title: string;
	url: string;
	content: string;
	sourceTitle?: string;
}): NoteDraft {
	const title = input.title.trim() || input.url;
	const content = input.content.trim();
	const linkText = input.sourceTitle?.trim() || title;
	const source = `Clipped from [${linkText}](${input.url})`;
	return { title, body: content ? `${source}${EMPTY_LINE}${content}` : source };
}
