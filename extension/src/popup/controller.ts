import type { CrapNoteClient, Note } from '../core/crapnote';
import type { Settings } from '../core/settings';
import type { Destination } from '../core/destinations';
import { buildLinkNote, buildClipNote } from '../core/note';
import { parseTagInput } from '../core/tags';
import { saveNote } from '../core/save';
import { inlineClipImages } from '../core/images';

export interface PopupContext {
	mode: 'link' | 'clip';
	url: string;
	title: string;
	content?: string;
	// Original srcs of the clipped images, in mask order.
	images?: string[];
}

export interface PopupDeps {
	settings: Settings;
	client: CrapNoteClient;
	context: PopupContext;
	destinations: Destination[];
	close(): void;
	openOptions(): void;
	fetchBlob(url: string): Promise<Blob>;
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

	// Datalist suggestions replace the whole input value when picked, so
	// each option carries the already-entered tags as a prefix — picking a
	// suggestion completes the current fragment instead of wiping the rest.
	const datalist = el<HTMLDataListElement>('tag-options');
	const tagsInput = el<HTMLInputElement>('tags');
	let knownTags: string[] = [];

	function refreshTagOptions(): void {
		const value = tagsInput.value;
		const lastComma = value.lastIndexOf(',');
		const prefix = lastComma === -1 ? '' : value.slice(0, lastComma + 1).replace(/\s*$/, ' ');
		const fragment = value.slice(lastComma + 1).trim().toLowerCase();
		const chosen = new Set(
			parseTagInput(lastComma === -1 ? '' : value.slice(0, lastComma)).map((t) =>
				t.toLowerCase(),
			),
		);
		datalist.replaceChildren();
		for (const name of knownTags) {
			const lower = name.toLowerCase();
			if (chosen.has(lower) || !lower.startsWith(fragment)) continue;
			const option = doc.createElement('option');
			option.setAttribute('value', `${prefix}${name}`);
			datalist.appendChild(option);
		}
	}

	tagsInput.addEventListener('input', refreshTagOptions);
	client
		.listTags()
		.then((tags) => {
			knownTags = tags.map((t) => t.name);
			refreshTagOptions();
		})
		.catch(() => {
			/* autocomplete is best-effort; saving still works without it */
		});

	el<HTMLFormElement>('save-form').addEventListener('submit', (e) => {
		e.preventDefault();
		void save();
	});

	// Carried across failed attempts so a retry never duplicates work: the
	// note from a partially-successful save is reused, and destinations
	// that already accepted the page aren't sent it again.
	let createdNote: Note | undefined;
	const savedDestinations = new Set<string>();
	const uploadedImages = new Map<string, string>();

	async function save(): Promise<void> {
		const status = el('status');
		const button = el<HTMLButtonElement>('save');
		button.disabled = true;
		status.textContent = 'Saving…';
		try {
			const title = el<HTMLInputElement>('title').value;
			let content = el<HTMLTextAreaElement>('content').value;
			if (context.mode === 'clip') {
				// The <image content> masks are display-only; the saved note
				// gets the real images.
				content = await inlineClipImages(
					content,
					context.images ?? [],
					{ fetchBlob: deps.fetchBlob, upload: (blob) => client.uploadImage(blob) },
					uploadedImages,
				);
			}
			const draft =
				context.mode === 'clip'
					? buildClipNote({ title, url: context.url, content, sourceTitle: context.title })
					: buildLinkNote({ title, url: context.url, description: content });
			const tagNames = parseTagInput(el<HTMLInputElement>('tags').value);
			createdNote = await saveNote(client, draft, tagNames, createdNote, (note) => {
				createdNote = note;
			});
			// The default link tag only marks the note as a link inside
			// CrapNote — at a destination everything is a link, so drop it.
			const labels = tagNames.filter(
				(t) => t.toLowerCase() !== settings.defaultLinkTag.toLowerCase(),
			);
			for (const dest of destinations) {
				if (destinationChecks.get(dest.id)?.checked && !savedDestinations.has(dest.id)) {
					await dest.save({ url: context.url, title: draft.title, labels }, settings);
					savedDestinations.add(dest.id);
				}
			}
			deps.close();
		} catch (err) {
			status.textContent = err instanceof Error ? err.message : 'Save failed';
			button.disabled = false;
		}
	}
}
