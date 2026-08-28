import type { CrapNoteClient } from '../core/crapnote';
import type { Settings } from '../core/settings';
import type { Destination } from '../core/destinations';
import { buildLinkNote, buildClipNote } from '../core/note';
import { parseTagInput } from '../core/tags';
import { saveNote } from '../core/save';

export interface PopupContext {
	mode: 'link' | 'clip';
	url: string;
	title: string;
	content?: string;
}

export interface PopupDeps {
	settings: Settings;
	client: CrapNoteClient;
	context: PopupContext;
	destinations: Destination[];
	close(): void;
	openOptions(): void;
}

export async function initPopup(doc: Document, deps: PopupDeps): Promise<void> {
	const { settings, client, context } = deps;
	const el = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;

	el<HTMLOutputElement>('url').textContent = context.url;
	el<HTMLInputElement>('title').value = context.title;
	el<HTMLInputElement>('tags').value =
		context.mode === 'clip' ? settings.defaultClipTag : settings.defaultLinkTag;

	// Destinations (e.g. Readeck) take the full page, so they only apply in
	// link mode — a clip is note content, not a page to bookmark.
	const destinations = context.mode === 'link' ? deps.destinations : [];
	const destinationChecks = new Map<string, HTMLInputElement>();
	const rows = el('destination-rows');
	for (const dest of destinations) {
		const label = doc.createElement('label');
		label.className = 'destination';
		const checkbox = doc.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.id = `dest-${dest.id}`;
		label.appendChild(checkbox);
		label.appendChild(doc.createTextNode(` Also save to ${dest.label}`));
		rows.appendChild(label);
		destinationChecks.set(dest.id, checkbox);
	}

	if (context.mode === 'clip') {
		el('heading').textContent = 'Save web clip';
		el('content-label').textContent = 'Content';
		el<HTMLTextAreaElement>('content').value = context.content ?? '';
	}

	el<HTMLAnchorElement>('open-options').addEventListener('click', (e) => {
		e.preventDefault();
		deps.openOptions();
	});

	if (!settings.serverUrl || !settings.apiToken) {
		el('unconfigured').hidden = false;
		el<HTMLButtonElement>('save').disabled = true;
		return;
	}

	const datalist = el<HTMLDataListElement>('tag-options');
	client
		.listTags()
		.then((tags) => {
			for (const tag of tags) {
				const option = doc.createElement('option');
				option.setAttribute('value', tag.name);
				datalist.appendChild(option);
			}
		})
		.catch(() => {
			/* autocomplete is best-effort; saving still works without it */
		});

	el<HTMLFormElement>('save-form').addEventListener('submit', (e) => {
		e.preventDefault();
		void save();
	});

	async function save(): Promise<void> {
		const status = el('status');
		const button = el<HTMLButtonElement>('save');
		button.disabled = true;
		status.textContent = 'Saving…';
		try {
			const title = el<HTMLInputElement>('title').value;
			const content = el<HTMLTextAreaElement>('content').value;
			const draft =
				context.mode === 'clip'
					? buildClipNote({ title, url: context.url, content })
					: buildLinkNote({ title, url: context.url, description: content });
			const tagNames = parseTagInput(el<HTMLInputElement>('tags').value);
			await saveNote(client, draft, tagNames);
			for (const dest of destinations) {
				if (destinationChecks.get(dest.id)?.checked) {
					await dest.save(
						{ url: context.url, title: draft.title, labels: tagNames },
						settings,
					);
				}
			}
			deps.close();
		} catch (err) {
			status.textContent = err instanceof Error ? err.message : 'Save failed';
			button.disabled = false;
		}
	}
}
