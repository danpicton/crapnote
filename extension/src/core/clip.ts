export const IMAGE_MASK = '<image content>';

// A multi-image clip numbers its masks (`<image content 2>`) so each mask
// stays paired with its own image even when the user deletes or reorders
// masks in the content box; a single image keeps the plain mask.
export function imageMask(index: number, total: number): string {
	return total > 1 ? `<image content ${index + 1}>` : IMAGE_MASK;
}

// Sentinel wrapped around preformatted runs so whitespace normalisation
// skips them. Kept as an escape — a literal NUL would make this file
// binary to git and grep.
const PRE_MARK = '\u0000';

const BLOCK_TAGS = new Set([
	'P', 'DIV', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
	'BLOCKQUOTE', 'PRE', 'TABLE', 'UL', 'OL', 'SECTION', 'ARTICLE', 'FIGURE',
]);

const CELL_TAGS = new Set(['TD', 'TH']);

// Cells are separated inline rather than by adding them to BLOCK_TAGS: a
// block break would put every cell in its own paragraph and lose the row
// structure that TR already carries.
const CELL_SEPARATOR = ' | ';

// Converts a captured selection's HTML into plain text for the clip content
// box. Text comes through as-is; every image is masked (and only masked)
// with the literal `<image content>` marker. Block elements become
// paragraph breaks; table cells are separated inline within their row.
export function clipTextFromHTML(html: string): string {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	const parts: string[] = [];
	const counter = { next: 0, total: doc.querySelectorAll('img').length };
	walk(doc.body, parts, false, counter);
	// Preformatted runs are wrapped in PRE_MARK so the whitespace
	// normalisation below leaves them untouched.
	return parts
		.join('')
		.split(PRE_MARK)
		.map((chunk, i) =>
			i % 2 === 1
				? chunk
				: chunk.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n'),
		)
		.join('')
		.trim();
}

// Image srcs in document order — the same order clipTextFromHTML emits its
// masks, so mask N corresponds to source N. Selection HTML carries srcs as
// authored (often relative), so they are resolved against the page URL —
// without this, fetching them from the popup resolves against the
// extension origin and fails.
export function imageSourcesFromHTML(html: string, pageURL?: string): string[] {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	return Array.from(doc.querySelectorAll('img')).map((img) => {
		const src = img.getAttribute('src') ?? '';
		// An empty src must stay empty: resolving it would yield the page
		// URL itself and the HTML document would be uploaded as an image.
		if (!pageURL || !src) return src;
		try {
			return new URL(src, pageURL).href;
		} catch {
			return src;
		}
	});
}

// For "clip selection without images": drops every image so neither masks
// nor uploads are produced.
export function stripImagesFromHTML(html: string): string {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	for (const img of Array.from(doc.querySelectorAll('img'))) img.remove();
	return doc.body.innerHTML;
}

function walk(
	node: Node,
	parts: string[],
	preformatted: boolean,
	counter: { next: number; total: number },
): void {
	// Cells emitted from this node — non-zero only while walking a row, so
	// a non-cell child (TR also admits <script> and <template>) never reads
	// as a preceding column.
	let cells = 0;
	for (const child of Array.from(node.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE) {
			const text = child.textContent ?? '';
			parts.push(preformatted ? text : text.replace(/\s+/g, ' '));
			continue;
		}
		if (child.nodeType !== Node.ELEMENT_NODE) continue;
		const el = child as Element;
		if (el.tagName === 'IMG') {
			parts.push(imageMask(counter.next++, counter.total));
			continue;
		}
		if (el.tagName === 'BR') {
			parts.push('\n');
			continue;
		}
		if (el.tagName === 'PRE') {
			parts.push(`\n\n${PRE_MARK}`);
			walk(el, parts, true, counter);
			parts.push(`${PRE_MARK}\n\n`);
			continue;
		}
		if (CELL_TAGS.has(el.tagName)) {
			// A cell is resolved on its own so the block breaks around its
			// content (cells commonly wrap theirs in a <div> or <p>) are
			// trimmed off before it joins the row — otherwise the separator
			// is stranded on a line of its own. Only whitespace is trimmed,
			// so PRE_MARK sentinels stay paired.
			const cellParts: string[] = [];
			walk(el, cellParts, preformatted, counter);
			const cell = cellParts.join('').trim();
			// An empty cell contributes no separator: a row must not open or
			// close with one dangling.
			if (!cell) continue;
			if (cells > 0) parts.push(CELL_SEPARATOR);
			parts.push(cell);
			cells++;
			continue;
		}
		const isBlock = BLOCK_TAGS.has(el.tagName);
		if (isBlock) parts.push('\n\n');
		walk(el, parts, preformatted, counter);
		if (isBlock) parts.push('\n\n');
	}
}
