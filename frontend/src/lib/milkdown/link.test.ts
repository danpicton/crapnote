import { describe, it, expect, vi } from 'vitest';

// Mock all Milkdown/ProseMirror imports so we can import link.ts in jsdom
vi.mock('@milkdown/kit/utils', () => ({
	$prose: vi.fn((fn: unknown) => fn),
	$pasteRule: vi.fn((fn: unknown) => fn),
	$inputRule: vi.fn((fn: unknown) => fn),
}));
vi.mock('@milkdown/kit/prose/inputrules', () => ({ InputRule: vi.fn() }));
vi.mock('@milkdown/kit/prose/state', () => ({ Plugin: vi.fn(), PluginKey: vi.fn() }));
vi.mock('@milkdown/kit/prose/model', () => ({ Fragment: { from: vi.fn() }, Slice: vi.fn() }));
vi.mock('@milkdown/kit/prose/view', () => ({}));
vi.mock('@milkdown/kit/preset/commonmark', () => ({
	linkSchema: {
		// Capture the extension handler so tests can exercise the wrapped spec.
		extendSchema: vi.fn((handler: unknown) => ({ __handler: handler })),
	},
}));

import { Plugin } from '@milkdown/kit/prose/state';
import { isUrl, normalizeUrl, isSafeHref, sanitizeHref, safeLinkMarkSchema, linkKeymapPlugin } from './link';

describe('isUrl', () => {
	it('accepts https URLs', () => {
		expect(isUrl('https://example.com')).toBe(true);
	});

	it('accepts http URLs', () => {
		expect(isUrl('http://example.com')).toBe(true);
	});

	it('accepts URLs with paths and query strings', () => {
		expect(isUrl('https://example.com/path?q=1&r=2')).toBe(true);
	});

	it('accepts www. prefixed addresses', () => {
		expect(isUrl('www.example.com')).toBe(true);
	});

	it('rejects plain words', () => {
		expect(isUrl('notaurl')).toBe(false);
	});

	it('rejects ftp:// schemes', () => {
		expect(isUrl('ftp://example.com')).toBe(false);
	});

	it('rejects empty string', () => {
		expect(isUrl('')).toBe(false);
	});

	it('rejects bare domain without www or scheme', () => {
		expect(isUrl('example.com')).toBe(false);
	});

	it('rejects https:// with nothing after the scheme', () => {
		expect(isUrl('https://')).toBe(false);
	});
});

describe('normalizeUrl', () => {
	it('leaves https:// URLs unchanged', () => {
		expect(normalizeUrl('https://example.com')).toBe('https://example.com');
	});

	it('leaves http:// URLs unchanged', () => {
		expect(normalizeUrl('http://example.com')).toBe('http://example.com');
	});

	it('prepends https:// to URLs without a scheme', () => {
		expect(normalizeUrl('example.com')).toBe('https://example.com');
	});

	it('prepends https:// to www. URLs', () => {
		expect(normalizeUrl('www.example.com')).toBe('https://www.example.com');
	});

	it('trims leading and trailing whitespace', () => {
		expect(normalizeUrl('  https://example.com  ')).toBe('https://example.com');
	});

	it('preserves paths and query strings', () => {
		expect(normalizeUrl('https://example.com/a?b=c')).toBe('https://example.com/a?b=c');
	});
});

describe('isSafeHref / sanitizeHref', () => {
	it.each([
		'javascript:alert(1)',
		'JaVaScRiPt:alert(document.cookie)',
		'java\nscript:alert(1)', // control chars are stripped by browsers before scheme parsing
		' \tjavascript:alert(1)',
		'data:text/html,<script>alert(1)</script>',
		'vbscript:msgbox(1)',
		'file:///etc/passwd',
		'//evil.example.com/phish', // protocol-relative resolves off-origin
		'/\\evil.example.com', // backslash variants browsers normalise to //
		'\\\\evil.example.com',
		'\\/evil.example.com',
		' //evil.example.com', // leading whitespace stripped before checking
	])('neutralises %s', (href) => {
		expect(isSafeHref(href)).toBe(false);
		expect(sanitizeHref(href)).toBe('');
	});

	it.each([
		'https://example.com',
		'http://example.com/a?b=c',
		'mailto:someone@example.com',
		'/relative/path',
		'relative.html',
		'#fragment',
		'?query=1',
	])('preserves %s', (href) => {
		expect(isSafeHref(href)).toBe(true);
		expect(sanitizeHref(href)).toBe(href);
	});

	it('neutralises non-string hrefs', () => {
		expect(sanitizeHref(null)).toBe('');
		expect(sanitizeHref(undefined)).toBe('');
	});
});

describe('safeLinkMarkSchema', () => {
	type MarkLike = { attrs: Record<string, unknown> };
	type SpecLike = {
		parseDOM: Array<{ tag: string; getAttrs: (dom: unknown) => Record<string, unknown> | false }>;
		toDOM: (mark: MarkLike) => unknown[];
	};

	const baseSpec = {
		attrs: { href: {}, title: { default: null } },
		parseDOM: [],
		toDOM: (mark: MarkLike) => ['a', { class: 'link', ...mark.attrs }],
	};
	const handler = (safeLinkMarkSchema as unknown as { __handler: (prev: unknown) => (ctx: unknown) => SpecLike }).__handler;
	const spec = handler(() => baseSpec)({});

	it('toDOM drops an unsafe href but keeps the rest of the mark', () => {
		const [tag, attrs] = spec.toDOM({ attrs: { href: 'javascript:alert(1)', title: null } }) as [string, Record<string, unknown>];
		expect(tag).toBe('a');
		expect('href' in attrs).toBe(false);
		expect(attrs.class).toBe('link');
	});

	it('toDOM keeps a safe href', () => {
		const [, attrs] = spec.toDOM({ attrs: { href: 'https://example.com', title: null } }) as [string, Record<string, unknown>];
		expect(attrs.href).toBe('https://example.com');
	});

	it('parseDOM sanitises pasted anchors with unsafe schemes', () => {
		const a = document.createElement('a');
		a.setAttribute('href', 'data:text/html,<script>alert(1)</script>');
		const attrs = spec.parseDOM[0].getAttrs(a);
		expect(attrs && attrs.href).toBe('');
	});

	it('parseDOM keeps safe pasted hrefs', () => {
		const a = document.createElement('a');
		a.setAttribute('href', 'https://example.com/x');
		a.setAttribute('title', 't');
		const attrs = spec.parseDOM[0].getAttrs(a);
		expect(attrs && attrs.href).toBe('https://example.com/x');
		expect(attrs && attrs.title).toBe('t');
	});
});

describe('link click handling', () => {
	/** Build the plugin and dig out the click handler it registered. */
	function clickHandler() {
		vi.mocked(Plugin).mockClear();
		(linkKeymapPlugin as unknown as () => unknown)();
		const config = vi.mocked(Plugin).mock.calls[0][0] as {
			props: { handleDOMEvents: { click: (view: unknown, e: MouseEvent) => boolean } };
		};
		return config.props.handleDOMEvents.click;
	}

	function anchorEvent() {
		const a = document.createElement('a');
		a.setAttribute('href', 'https://example.com');
		const event = new MouseEvent('click', { bubbles: true });
		Object.defineProperty(event, 'target', { value: a });
		return event;
	}

	it('opens the link on a plain click', () => {
		const open = vi.spyOn(window, 'open').mockImplementation(() => null);
		const view = { state: { selection: { empty: true } } };

		expect(clickHandler()(view, anchorEvent())).toBe(true);
		expect(open).toHaveBeenCalled();
		open.mockRestore();
	});

	it('does not navigate when a drag-select finished on the link', () => {
		const open = vi.spyOn(window, 'open').mockImplementation(() => null);
		const view = { state: { selection: { empty: false } } };

		expect(clickHandler()(view, anchorEvent())).toBe(false);
		expect(open).not.toHaveBeenCalled();
		open.mockRestore();
	});
});
