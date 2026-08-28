/**
 * Note preview text for the mobile note list.
 *
 * The list shows a couple of lines of the note body with the markdown taken
 * off. Links get special treatment: whatever syntax they were written in
 * (`[label](url)`, an `<url>` autolink, or a bare url pasted straight in) the
 * preview shows the bare text, marked as a link so the list can underline it.
 * The preview never links out — a note is opened by tapping the row.
 *
 * Block markup is shown rather than stripped, so the first lines of a list
 * read the way they do in the editor: bullets get `•`, numbered items keep
 * their number, task items get an empty or ticked box, and headings are
 * emphasised without changing size. Tables are too wide to be worth a couple
 * of clipped rows, so they collapse to a placeholder the way images do.
 */

export interface PreviewSegment {
	/** Text to render. */
	text: string;
	/** True when this run of text came from a link. */
	link?: boolean;
	/** True when this run of text came from a heading. */
	bold?: boolean;
}

const MAX_LENGTH = 300;

const IMAGE_PLACEHOLDER = '<image content>';
const TABLE_PLACEHOLDER = '<table content>';

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

const HEADING = /^#{1,6}\s+(.*)$/;
const BULLET = /^[-*+]\s+(.*)$/;
const ORDERED = /^(\d{1,9})[.)]\s+(.*)$/;
/** A task marker, matched against what is left of a list item. */
const TASK = /^\[([ xX])\]\s*(.*)$/;

function stripInline(text: string): string {
	return text
		.replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
		.replace(/\*\*([^*]+)\*\*/g, '$1')
		.replace(/__([^_]+)__/g, '$1')
		.replace(/\*([^*\n]+)\*/g, '$1')
		.replace(/_([^_\n]+)_/g, '$1');
}

/** One line of the preview, with the block-level styling it carries. */
interface PreviewLine {
	text: string;
	bold?: boolean;
}

/**
 * A table's `|---|:--:|` separator, which is what tells a row of pipes apart
 * from a sentence that merely contains one.
 */
function isTableDelimiter(line: string | undefined): boolean {
	if (line === undefined) return false;
	const trimmed = line.trim();
	return trimmed.includes('|') && trimmed.includes('-') && /^[\s|:-]+$/.test(trimmed);
}

function countPipes(line: string): number {
	return (line.match(/\|/g) ?? []).length;
}

/**
 * A body row of a table already under way. Rows written with outer pipes are
 * unmistakable; without them, only a line carrying the same number of cell
 * separators as the separator row counts. So a sentence that merely happens
 * to contain a pipe ends the table instead of disappearing into it.
 */
function isTableRow(line: string | undefined, cells: number): boolean {
	if (line === undefined) return false;
	const trimmed = line.trim();
	if (!trimmed.includes('|')) return false;
	return trimmed.startsWith('|') || countPipes(trimmed) === cells;
}

/**
 * An image in a paragraph gets a line of its own so the placeholder does not
 * run into the prose that follows it. Inside a list item or a heading it stays
 * put — one item is one preview line.
 */
function paragraphLines(text: string): string[] {
	const parts = text.split(IMAGE_PLACEHOLDER);
	const lines = parts.slice(0, -1).map((part) => `${part}${IMAGE_PLACEHOLDER}`.trim());
	lines.push(parts[parts.length - 1].trim());
	return lines.filter(Boolean);
}

/** Renders a list item, which may in turn be a task item. */
function listItem(marker: string, content: string): string {
	const task = TASK.exec(content);
	if (task) return `${task[1] === ' ' ? '☐' : '☑'} ${task[2].trim()}`.trim();
	return `${marker} ${content.trim()}`.trim();
}

/**
 * Turns markdown blocks into the lines the preview shows. Blank lines are
 * dropped so the visible couple of lines carry as much of the note as
 * possible, and indentation goes with them — the preview collapses runs of
 * whitespace anyway, so nesting cannot show.
 */
function toPreviewLines(source: string): PreviewLine[] {
	const raw = source.split('\n');
	const lines: PreviewLine[] = [];

	for (let index = 0; index < raw.length; index++) {
		const line = raw[index].trim();
		if (!line) continue;

		// Header row, separator, and every body row collapse to one placeholder.
		if (line.includes('|') && isTableDelimiter(raw[index + 1])) {
			const cells = countPipes(raw[index + 1].trim());
			index++;
			while (isTableRow(raw[index + 1], cells)) index++;
			lines.push({ text: TABLE_PLACEHOLDER });
			continue;
		}

		const heading = HEADING.exec(line);
		if (heading) {
			const text = heading[1].trim();
			if (text) lines.push({ text, bold: true });
			continue;
		}

		const bullet = BULLET.exec(line);
		if (bullet) {
			lines.push({ text: listItem('•', bullet[1]) });
			continue;
		}

		const ordered = ORDERED.exec(line);
		if (ordered) {
			lines.push({ text: listItem(`${ordered[1]}.`, ordered[2]) });
			continue;
		}

		for (const text of paragraphLines(line)) lines.push({ text });
	}

	return lines;
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
		// Images → placeholder. The line break an image earns in a paragraph is
		// added later, once the block it sits in is known — inside a list item
		// it must not split the item away from its own bullet.
		.replace(/!\[[^\]]*\]\([^)]*\)/g, IMAGE_PLACEHOLDER)
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
		.replace(/^[-*_]{3,}\s*$/gm, '');

	const segments: PreviewSegment[] = [];
	let used = 0;

	const push = (text: string, marks: Omit<PreviewSegment, 'text'>) => {
		if (used >= MAX_LENGTH) return;
		const clipped = text.slice(0, MAX_LENGTH - used);
		if (!clipped) return;
		used += clipped.length;
		segments.push({ text: clipped, ...marks });
	};

	toPreviewLines(stripped).forEach((line, lineIndex) => {
		if (lineIndex > 0) push('\n', {});
		const marks: Omit<PreviewSegment, 'text'> = line.bold ? { bold: true } : {};

		// split() alternates: text, captured link index, text, …
		line.text.split(PLACEHOLDER).forEach((part, index) => {
			const isLink = index % 2 === 1;
			if (isLink) push(links[Number(part)] ?? '', { ...marks, link: true });
			else push(part, marks);
		});
	});

	return segments;
}

/** The same preview as plain text, with the link markers dropped. */
export function notePreview(body: string): string {
	return notePreviewSegments(body)
		.map((segment) => segment.text)
		.join('');
}
