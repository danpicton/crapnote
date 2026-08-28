import { loadSettings, saveSettings } from '../core/settings';
import type { KVStore } from '../core/storage';

export async function initOptions(doc: Document, store: KVStore): Promise<void> {
	const input = (id: string) => doc.getElementById(id) as HTMLInputElement;
	const settings = await loadSettings(store);

	input('server-url').value = settings.serverUrl;
	input('api-token').value = settings.apiToken;
	input('default-link-tag').value = settings.defaultLinkTag;
	input('default-clip-tag').value = settings.defaultClipTag;
	input('readeck-url').value = settings.readeckUrl;
	input('readeck-token').value = settings.readeckToken;

	doc.getElementById('options-form')!.addEventListener('submit', (e) => {
		e.preventDefault();
		void (async () => {
			await saveSettings(store, {
				serverUrl: input('server-url').value.trim().replace(/\/+$/, ''),
				apiToken: input('api-token').value.trim(),
				defaultLinkTag: input('default-link-tag').value.trim(),
				defaultClipTag: input('default-clip-tag').value.trim(),
				readeckUrl: input('readeck-url').value.trim().replace(/\/+$/, ''),
				readeckToken: input('readeck-token').value.trim(),
			});
			const status = doc.getElementById('status');
			if (status) status.textContent = 'Saved.';
		})();
	});
}
