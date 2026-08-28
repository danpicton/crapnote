/**
 * Note preview text for the mobile note list.
 *
 * The list shows a couple of lines of the note body with the markdown taken
 * off. Links get special treatment: whatever syntax they were written in
 * (`[label](url)`, an `<url>` autolink, or a bare url pasted straight in) the
 * preview shows the bare text, marked as a link so the list can underline it.
 * The preview never links out — a note is opened by tapping the row.
 */

export interface PreviewSegment {
	/** Text to render. */
	text: string;
	/** True when this run of text came from a link. */
	link?: boolean;
}

const MAX_LENGTH = 300;

/**
 * Matches the placeholder we park extracted links behind while stripping
 * markdown. A private-use code point, so it can never collide with note text.
 */
const PLACEHOLDER = /\uE000(\d+)\uE000/;

const MARKDOWN_LINK = /\[([^\]]+)\]\([^)]+\)/g;
// The placeholder character is excluded so a url can never swallow a link
// parked earlier in the pass — two links with nothing between them are common.
const AUTOLINK = /<(https?:\/\/[^>\s\uE000]+)>/g;
const BARE_URL = /https?:\/\/[^\s<>()[\]\uE000]+/g;
/**
 * Trailing characters that belong to the sentence rather than to the url:
 * punctuation, and the closing half of `**bold**` / `_italic_` wrapping. Bare
 * urls are parked before emphasis is stripped, so without this the url would
 * swallow its own closing marker and orphan the opening one.
 */
const TRAILING_NON_URL = /[.,;:!?*_]+$/;

function stripInline(text: string): string {
	return text
		.replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
		.replace(/\*\*([^*]+)\*\*/g, '$1')
		.replace(/__([^_]+)__/g, '$1')
		.replace(/\*([^*\n]+)\*/g, '$1')
		.replace(/_([^_\n]+)_/g, '$1');
}

/**
 * Breaks a note body into plain-text and link runs, in order, capped at 300
 * characters of visible text.
 */
export function notePreviewSegments(body: string): PreviewSegment[] {
	if (!body?.trim()) return [];

	const links: string[] = [];
	const park = (text: string) => `\uE000${links.push(text) - 1}\uE000`;

	const parked = body
		// Drop any placeholder character the note itself contains, so a parked
		// link can never be confused with the note's own text.
		.replace(/\uE000/g, '')
		// HTML line breaks → newline
		.replace(/<br\s*\/?>/gi, '\n')
		// Images → placeholder
		.replace(/!\[[^\]]*\]\([^)]*\)/g, '<image content>\n')
		// Links of every flavour → parked, so markdown stripping can't mangle
		// urls that contain `_`, `*` or other markup characters.
		.replace(MARKDOWN_LINK, (_match, label: string) => park(stripInline(label)))
		.replace(AUTOLINK, (_match, url: string) => park(url))
		.replace(BARE_URL, (match) => {
			const url = match.replace(TRAILING_NON_URL, '');
			return park(url) + match.slice(url.length);
		});

	// Bold & italic → plain text
	const stripped = stripInline(parked)
		// Blockquotes → strip marker
		.replace(/^>\s?/gm, '')
		// Horizontal rules → remove line
		.replace(/^[-*_]{3,}\s*$/gm, '')
		.replace(/\n{2,}/g, '\n')
		.trim();

	const segments: PreviewSegment[] = [];
	let used = 0;

	// split() alternates: text, captured link index, text, …
	stripped.split(PLACEHOLDER).forEach((part, index) => {
		if (used >= MAX_LENGTH) return;
		const isLink = index % 2 === 1;
		const text = (isLink ? (links[Number(part)] ?? '') : part).slice(0, MAX_LENGTH - used);
		if (!text) return;
		used += text.length;
		segments.push(isLink ? { text, link: true } : { text });
	});

	return segments;
}

/** The same preview as plain text, with the link markers dropped. */
export function notePreview(body: string): string {
	return notePreviewSegments(body)
		.map((segment) => segment.text)
		.join('');
}
