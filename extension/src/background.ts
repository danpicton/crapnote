import { ext } from './browser';
import {
	MENU_CLIP_SELECTION,
	MENU_CLIP_IMAGE,
	clipPayloadFromClick,
	escapeHTML,
} from './core/clipPayload';

ext.runtime.onInstalled.addListener(() => {
	ext.contextMenus.create({
		id: MENU_CLIP_SELECTION,
		title: 'Clip selection to CrapNote',
		contexts: ['selection'],
	});
	ext.contextMenus.create({
		id: MENU_CLIP_IMAGE,
		title: 'Clip image to CrapNote',
		contexts: ['image'],
	});
});

// Runs inside the page: serialize the current selection as HTML so the
// popup can mask images and extract text.
function captureSelectionHTML(): string {
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0) return '';
	const container = document.createElement('div');
	for (let i = 0; i < sel.rangeCount; i++) {
		container.appendChild(sel.getRangeAt(i).cloneContents());
	}
	return container.innerHTML;
}

ext.contextMenus.onClicked.addListener((info, tab) => {
	void (async () => {
		if (!tab?.id) return;
		let selectionHTML = '';
		if (info.menuItemId === MENU_CLIP_SELECTION) {
			try {
				const results = await ext.scripting.executeScript({
					target: { tabId: tab.id },
					func: captureSelectionHTML,
				});
				selectionHTML = (results[0]?.result as string) ?? '';
			} catch {
				selectionHTML = escapeHTML(info.selectionText ?? '');
			}
		} else if (info.menuItemId !== MENU_CLIP_IMAGE) {
			return;
		}

		const payload = clipPayloadFromClick(info, tab, selectionHTML);
		await ext.storage.local.set({ pendingClip: payload });
		await ext.windows.create({
			url: ext.runtime.getURL('popup.html?mode=clip'),
			type: 'popup',
			width: 440,
			height: 620,
		});
	})();
});
