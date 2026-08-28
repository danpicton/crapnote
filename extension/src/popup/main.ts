import { ext, syncStore, localStore } from '../browser';
import { loadSettings } from '../core/settings';
import { CrapNoteClient } from '../core/crapnote';
import { availableDestinations } from '../core/destinations';
import { clipTextFromHTML, imageSourcesFromHTML, stripImagesFromHTML } from '../core/clip';
import { isFreshClip, type ClipPayload } from '../core/clipPayload';
import { initPopup, type PopupContext } from './controller';

async function popupContext(): Promise<PopupContext> {
	// Clip mode when the background just stored a pending clip (the popup
	// is opened via action.openPopup, so the URL alone can't tell) or when
	// the fallback window forces it via ?mode=clip. The payload is consumed
	// so a later plain toolbar click opens link mode again.
	const forced = new URLSearchParams(location.search).get('mode') === 'clip';
	const { pendingClip } = await localStore().get(['pendingClip']);
	const clip = pendingClip as ClipPayload | undefined;
	if (clip && (forced || isFreshClip(clip, Date.now()))) {
		void ext.storage.local.remove('pendingClip');
		const html = clip.includeImages === false ? stripImagesFromHTML(clip.html) : clip.html;
		return {
			mode: 'clip',
			url: clip.url,
			title: clip.title,
			content: clipTextFromHTML(html),
			images: imageSourcesFromHTML(html, clip.url),
		};
	}
	const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
	return { mode: 'link', url: tab?.url ?? '', title: tab?.title ?? '' };
}

void (async () => {
	const settings = await loadSettings(syncStore());
	await initPopup(document, {
		settings,
		client: new CrapNoteClient(settings),
		context: await popupContext(),
		destinations: availableDestinations(settings),
		close: () => window.close(),
		openOptions: () => void ext.runtime.openOptionsPage(),
		fetchBlob: async (url) => {
			const res = await fetch(url);
			if (!res.ok) throw new Error(`fetch image failed: ${res.status}`);
			return res.blob();
		},
	});
})();
