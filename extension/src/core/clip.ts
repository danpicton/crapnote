const IMAGE_MASK = '<image content>';

const BLOCK_TAGS = new Set([
	'P', 'DIV', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
	'BLOCKQUOTE', 'PRE', 'TABLE', 'UL', 'OL', 'SECTION', 'ARTICLE', 'FIGURE',
]);

// Converts a captured selection's HTML into plain text for the clip content
// box. Text comes through as-is; every image is masked (and only masked)
// with the literal `<image content>` marker. Block elements become
// paragraph breaks.
export function clipTextFromHTML(html: string): string {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	const parts: string[] = [];
	walk(doc.body, parts);
	return parts
		.join('')
		.replace(/[ \t]+/g, ' ')
		.replace(/ ?\n ?/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function walk(node: Node, parts: string[]): void {
	for (const child of Array.from(node.childNodes)) {
		if (child.nodeType === Node.TEXT_NODE) {
			parts.push((child.textContent ?? '').replace(/\s+/g, ' '));
			continue;
		}
		if (child.nodeType !== Node.ELEMENT_NODE) continue;
		const el = child as Element;
		if (el.tagName === 'IMG') {
			parts.push(IMAGE_MASK);
			continue;
		}
		if (el.tagName === 'BR') {
			parts.push('\n');
			continue;
		}
		const isBlock = BLOCK_TAGS.has(el.tagName);
		if (isBlock) parts.push('\n\n');
		walk(el, parts);
		if (isBlock) parts.push('\n\n');
	}
}
