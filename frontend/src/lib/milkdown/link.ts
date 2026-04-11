/**
 * Link plugin for crapnote.
 *
 * The commonmark preset already includes linkSchema and toggleLinkCommand, so
 * this plugin only needs to add two behaviours on top:
 *
 *  1. Ctrl/Cmd+K keymap — fires a 'crapnote:insert-link' CustomEvent that
 *     bubbles up to the editor container so Svelte can show the URL dialog.
 *
 *  2. Paste handler — when a bare URL is pasted:
 *       • With text selected  → wraps the selection in a link mark.
 *       • With an empty cursor → inserts the URL as linked text.
 */

import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';

function isUrl(s: string): boolean {
	return /^https?:\/\/\S+/.test(s) || /^www\.\S+\.\S+/.test(s);
}

function normalizeUrl(url: string): string {
	const t = url.trim();
	return t.startsWith('http://') || t.startsWith('https://') ? t : `https://${t}`;
}

export const linkKeymapPlugin = $prose(() =>
	new Plugin({
		key: new PluginKey('crapnote-link-keymap'),
		props: {
			handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
				if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
					event.preventDefault();
					view.dom.dispatchEvent(
						new CustomEvent('crapnote:insert-link', { bubbles: true })
					);
					return true;
				}
				return false;
			},
		},
	})
);

export const linkPastePlugin = $prose(() =>
	new Plugin({
		key: new PluginKey('crapnote-link-paste'),
		props: {
			handlePaste(view: EditorView, event: ClipboardEvent): boolean {
				const raw = event.clipboardData?.getData('text/plain')?.trim() ?? '';
				if (!isUrl(raw)) return false;

				const { state } = view;
				const markType = state.schema.marks['link'];
				if (!markType) return false;

				const href = normalizeUrl(raw);
				event.preventDefault();

				if (!state.selection.empty) {
					// Wrap selected text in a link mark.
					const { from, to } = state.selection;
					view.dispatch(
						state.tr.addMark(from, to, markType.create({ href, title: null }))
					);
				} else {
					// No selection: insert the URL as linked text.
					const node = state.schema.text(href, [markType.create({ href, title: null })]);
					view.dispatch(state.tr.replaceSelectionWith(node));
				}
				return true;
			},
		},
	})
);

export const linkPlugin = [linkKeymapPlugin, linkPastePlugin].flat();
