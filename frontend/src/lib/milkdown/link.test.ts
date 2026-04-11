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

import { isUrl, normalizeUrl } from './link';

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
