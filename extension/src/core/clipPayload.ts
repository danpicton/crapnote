export const MENU_CLIP_SELECTION = 'crapnote-clip-selection';
export const MENU_CLIP_SELECTION_NO_IMAGES = 'crapnote-clip-selection-no-images';
export const MENU_CLIP_IMAGE = 'crapnote-clip-image';

// For plain text that will travel through the HTML clip pipeline (e.g. the
// selectionText fallback when script injection fails).
export function escapeHTML(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
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
			? `<img src="${info.srcUrl}">`
			: selectionHTML;
	return {
		url: tab.url ?? '',
		title: tab.title ?? '',
		html,
		includeImages: info.menuItemId !== MENU_CLIP_SELECTION_NO_IMAGES,
	};
}
