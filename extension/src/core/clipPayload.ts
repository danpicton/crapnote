export const MENU_CLIP_SELECTION = 'crapnote-clip-selection';
export const MENU_CLIP_IMAGE = 'crapnote-clip-image';

export interface ClipPayload {
	url: string;
	title: string;
	html: string;
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
	return { url: tab.url ?? '', title: tab.title ?? '', html };
}
