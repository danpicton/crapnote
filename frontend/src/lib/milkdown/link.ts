/**
 * Link plugin for crapnote.
 *
 * The commonmark preset already includes linkSchema, toggleLinkCommand, etc.
 * This plugin adds the interactive behaviours on top:
 *
 *  1. linkKeymapPlugin (Ctrl/Cmd+K)
 *       - If selected text is a bare URL → apply link mark directly.
 *       - Otherwise → fire 'crapnote:insert-link' so Svelte shows the URL dialog.
 *
 *  2. linkPasteRule ($pasteRule — runs inside Milkdown's paste pipeline)
 *       - Bare URL pasted with text selected → wrap selection in link.
 *       - Bare URL pasted at cursor        → insert as linked text.
 *       - Markdown [text](url) pasted      → inline text with link mark.
 *
 *  3. linkInputRule ($inputRule)
 *       - Typing [text](url) and pressing ) converts it to a link in place.
 */

import { $prose, $pasteRule, $inputRule } from '@milkdown/kit/utils';
import { InputRule } from '@milkdown/kit/prose/inputrules';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Fragment, Slice } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function isUrl(s: string): boolean {
	return /^https?:\/\/\S+/.test(s) || /^www\.\S+\.\S+/.test(s);
}

export function normalizeUrl(url: string): string {
	const t = url.trim();
	return t.startsWith('http://') || t.startsWith('https://') ? t : `https://${t}`;
}

// ─── 1. Ctrl/Cmd+K keymap ────────────────────────────────────────────────────

export const linkKeymapPlugin = $prose(() =>
	new Plugin({
		key: new PluginKey('crapnote-link-keymap'),
		props: {
			// Open links on click.
			handleDOMEvents: {
				click(_view: EditorView, event: MouseEvent): boolean {
					const anchor = (event.target as HTMLElement).closest('a');
					if (!anchor?.href) return false;
					event.preventDefault();
					window.open(anchor.href, '_blank', 'noopener,noreferrer');
					return true;
				},
			},

			handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
				if (!((event.ctrlKey || event.metaKey) && event.key === 'k')) return false;
				event.preventDefault();

				const { state } = view;
				const { from, to } = state.selection;

				// If the selection is a bare URL, apply the link immediately.
				if (from !== to) {
					const selectedText = state.doc.textBetween(from, to);
					if (isUrl(selectedText)) {
						const markType = state.schema.marks['link'];
						if (markType) {
							view.dispatch(
								state.tr.addMark(
									from,
									to,
									markType.create({ href: normalizeUrl(selectedText), title: null })
								)
							);
							return true;
						}
					}
				}

				// Otherwise show the URL dialog.
				view.dom.dispatchEvent(new CustomEvent('crapnote:insert-link', { bubbles: true }));
				return true;
			},
		},
	})
);

// ─── 2. Paste rule ────────────────────────────────────────────────────────────

export const linkPasteRule = $pasteRule(() => ({
	run(slice: Slice, view: EditorView, isPlainText: boolean): Slice {
		if (!isPlainText) return slice;

		let text = '';
		slice.content.forEach((node) => {
			text += node.textContent;
		});
		text = text.trim();

		const { state } = view;
		const markType = state.schema.marks['link'];
		if (!markType) return slice;

		// ── Bare URL ──────────────────────────────────────────────────────────
		if (isUrl(text)) {
			const href = normalizeUrl(text);

			if (!state.selection.empty) {
				// Wrap the selected text in the link.
				const { from, to } = state.selection;
				const selectedText = state.doc.textBetween(from, to);
				const node = state.schema.text(selectedText, [markType.create({ href, title: null })]);
				return new Slice(Fragment.from(node), 0, 0);
			}

			// Insert the URL itself as linked text.
			const node = state.schema.text(href, [markType.create({ href, title: null })]);
			return new Slice(Fragment.from(node), 0, 0);
		}

		// ── Markdown [text](url) ──────────────────────────────────────────────
		const mdLink = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
		if (!mdLink.test(text)) return slice;

		mdLink.lastIndex = 0;
		const nodes: ReturnType<typeof state.schema.text>[] = [];
		let last = 0;
		let m: RegExpExecArray | null;

		while ((m = mdLink.exec(text)) !== null) {
			if (m.index > last) nodes.push(state.schema.text(text.slice(last, m.index)));
			const [, linkText, href] = m;
			nodes.push(
				state.schema.text(linkText, [markType.create({ href: normalizeUrl(href), title: null })])
			);
			last = m.index + m[0].length;
		}
		if (last < text.length) nodes.push(state.schema.text(text.slice(last)));

		return new Slice(Fragment.from(nodes), 0, 0);
	},
}));

// ─── 3. Input rule ([text](url) → link as you type) ──────────────────────────

export const linkInputRule = $inputRule(
	(_ctx) =>
		new InputRule(/\[([^\]\n]+)\]\(([^)\s]+)\)$/, (state, match, start, end) => {
			const [, linkText, rawHref] = match;
			const markType = state.schema.marks['link'];
			if (!markType) return null;
			const node = state.schema.text(linkText, [
				markType.create({ href: normalizeUrl(rawHref), title: null }),
			]);
			return state.tr.replaceWith(start, end, node);
		})
);

// ─── Composed export ──────────────────────────────────────────────────────────

export const linkPlugin = [linkKeymapPlugin, linkPasteRule, linkInputRule].flat();
