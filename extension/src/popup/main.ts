import { ext, syncStore, localStore } from '../browser';
import { loadSettings } from '../core/settings';
import { CrapNoteClient } from '../core/crapnote';
import { availableDestinations } from '../core/destinations';
import { clipTextFromHTML } from '../core/clip';
import type { ClipPayload } from '../core/clipPayload';
import { initPopup, type PopupContext } from './controller';

async function popupContext(): Promise<PopupContext> {
	const mode = new URLSearchParams(location.search).get('mode');
	if (mode === 'clip') {
		const { pendingClip } = await localStore().get(['pendingClip']);
		const clip = (pendingClip ?? { url: '', title: '', html: '' }) as ClipPayload;
		return {
			mode: 'clip',
			url: clip.url,
			title: clip.title,
			content: clipTextFromHTML(clip.html),
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
	});
})();
