export const MENU_CLIP_SELECTION = 'crapnote-clip-selection';
export const MENU_CLIP_SELECTION_NO_IMAGES = 'crapnote-clip-selection-no-images';
export const MENU_CLIP_IMAGE = 'crapnote-clip-image';

// For untrusted strings interpolated into the HTML clip pipeline: the
// selectionText fallback when script injection fails, and the src of an
// image clip (a data: URL keeps its quotes verbatim, so unescaped it would
// terminate the attribute early and truncate the source).
export function escapeHTML(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

// A selection fragment can only begin with a table-internal tag when the
// selection was made wholly inside a table. Leading whitespace and comments
// can precede it; anything else means the fragment carries its own context.
const LEADING = String.raw`^(?:\s|<!--[\s\S]*?-->)*<`;
const CELL_FRAGMENT = new RegExp(`${LEADING}(?:td|th)[\\s/>]`, 'i');
const ROW_FRAGMENT = new RegExp(`${LEADING}(?:tr|thead|tbody|tfoot)[\\s/>]`, 'i');

// range.cloneContents() returns the children of the selection's common
// ancestor and never the ancestor itself, so dragging within a table yields
// bare <td>/<tr> with no <table> around them. The HTML parser discards
// table-internal tags found outside table context — taking the whole
// selection's text with them — so the context is restored here, before the
// payload is stored. The <tr> is explicit rather than left to implied-tag
// generation, which not every parser performs.
//
// Runs in the background service worker, which has no DOM in Chrome MV3, so
// this stays string-only.
export function restoreTableFragment(html: string): string {
	if (CELL_FRAGMENT.test(html)) return `<table><tr>${html}</tr></table>`;
	if (ROW_FRAGMENT.test(html)) return `<table>${html}</table>`;
	return html;
}

export interface ClipPayload {
	url: string;
	title: string;
	html: string;
	// false for "clip selection without images": the popup (which has the
	// DOM the background service worker lacks) strips them before display.
	includeImages: boolean;
	// Set when the payload is stored, so a stale leftover never hijacks a
	// plain toolbar click into clip mode.
	createdAt?: number;
}

const CLIP_TTL_MS = 15_000;

export function isFreshClip(payload: { createdAt?: number }, now: number): boolean {
	return payload.createdAt !== undefined && now - payload.createdAt < CLIP_TTL_MS;
}

// Builds the pending-clip payload stored for the popup. The payload carries
// raw HTML; the popup (which has a DOM, unlike Chrome's service worker)
// converts it to masked text with clipTextFromHTML.
export function clipPayloadFromClick(
	info: { menuItemId: string | number; srcUrl?: string },
	tab: { url?: string; title?: string },
	selectionHTML = '',
): ClipPayload {
	const html =
		info.menuItemId === MENU_CLIP_IMAGE && info.srcUrl
			? `<img src="${escapeHTML(info.srcUrl)}">`
			: restoreTableFragment(selectionHTML);
	return {
		url: tab.url ?? '',
		title: tab.title ?? '',
		html,
		includeImages: info.menuItemId !== MENU_CLIP_SELECTION_NO_IMAGES,
	};
}
