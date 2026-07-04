/**
 * Link plugin for crapnote.
 *
 * The commonmark preset already includes linkSchema, toggleLinkCommand, etc.
 * This plugin adds the interactive behaviours on top:
 *
 *  1. linkKeymapPlugin (Ctrl/Cmd+Shift+K)
 *       - If selected text is a bare URL → apply link mark directly.
 *       - Otherwise → fire 'crapnote:insert-link' so Svelte shows the URL dialog.
 *       (Ctrl/Cmd+K is reserved for focusing the app-wide search box.)
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
import { linkSchema } from '@milkdown/kit/preset/commonmark';
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

// Schemes a stored note is allowed to link to. Anything else — javascript:,
// data:, vbscript:, file:, … — is a stored-XSS / drive-by vector when the
// note body comes from another user or a leaked API token.
const SAFE_LINK_SCHEMES = new Set(['http', 'https', 'mailto']);

/**
 * True when the href is a relative URL or uses an allowlisted scheme.
 * Whitespace and control characters are removed before the scheme is read,
 * because browsers strip them when resolving URLs (`java\nscript:` runs).
 */
export function isSafeHref(href: string): boolean {
	// eslint-disable-next-line no-control-regex
	const cleaned = href.replace(/[\u0000-\u0020]/g, '');
	// Protocol-relative URLs ("//host/…", plus the backslash variants browsers
	// normalise to slashes) carry no scheme token but resolve OFF-origin, so
	// they must not pass as relative links.
	if (/^[/\\]{2}/.test(cleaned)) return false;
	const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(cleaned);
	if (!match) return true; // relative URL — resolves against our own origin
	return SAFE_LINK_SCHEMES.has(match[1].toLowerCase());
}

/** Returns the href unchanged when safe, or '' when it must be neutralised. */
export function sanitizeHref(href: unknown): string {
	if (typeof href !== 'string' || !isSafeHref(href)) return '';
	return href;
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
					const href = anchor?.getAttribute('href');
					if (!anchor || !href) return false;
					event.preventDefault();
					// safeLinkMarkSchema keeps unsafe hrefs out of the DOM, but
					// refuse to navigate to one here too in case an <a> arrives
					// through a path the schema doesn't own.
					if (!isSafeHref(href)) return true;
					window.open(anchor.href, '_blank', 'noopener,noreferrer');
					return true;
				},
			},

			handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
				if (!((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'k')) return false;
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
	() =>
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

// ─── 4. Scheme-filtered link mark schema ─────────────────────────────────────
//
// Re-registers the commonmark `link` mark with a sanitising wrapper. Because
// this is .use()d after the commonmark preset, it wins the schema slot, so it
// covers every path that puts a link into the DOM: markdown loaded from the
// server (defaultValueCtx), rich-content paste (parseDOM), and typing/paste
// rules. Unsafe hrefs are dropped from the rendered <a>; the stored markdown
// is left untouched so a save doesn't rewrite note content.

export const safeLinkMarkSchema = linkSchema.extendSchema((prev) => (ctx) => {
	const base = prev(ctx);
	return {
		...base,
		parseDOM: [
			{
				tag: 'a[href]',
				getAttrs: (dom) => {
					if (!(dom instanceof HTMLElement)) return false;
					return {
						href: sanitizeHref(dom.getAttribute('href')),
						title: dom.getAttribute('title'),
					};
				},
			},
		],
		toDOM: (mark, inline) => {
			const spec = base.toDOM?.(mark, inline);
			if (Array.isArray(spec) && spec[1] && typeof spec[1] === 'object' && !Array.isArray(spec[1])) {
				const attrs = { ...(spec[1] as Record<string, unknown>) };
				if (typeof attrs['href'] !== 'string' || !isSafeHref(attrs['href'])) {
					delete attrs['href'];
				}
				return [spec[0], attrs, ...spec.slice(2)] as typeof spec;
			}
			return spec ?? ['a', mark.attrs];
		},
	};
});

// ─── Composed export ──────────────────────────────────────────────────────────

export const linkPlugin = [linkKeymapPlugin, linkPasteRule, linkInputRule, safeLinkMarkSchema].flat();
