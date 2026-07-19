import { describe, it, expect, beforeEach, vi } from 'vitest';

// Import AFTER stubbing globals so the module picks up the stubs.
// Each test re-initialises the store because Svelte runes are module-level state.
// We reset between tests by calling init() with fresh localStorage/matchMedia.

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

// Dynamically import after stubs are set so the module sees fresh state each time.
async function freshTheme() {
	vi.resetModules();
	const mod = await import('./theme.svelte');
	return mod.theme;
}

const STORAGE_KEY = 'crapnote-theme';

describe('theme store', () => {
	beforeEach(() => {
		localStorage.clear();
		document.documentElement.removeAttribute('data-theme');
		// Default: system prefers light
		vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
	});

	it('defaults to light when localStorage is empty and system prefers light', async () => {
		const theme = await freshTheme();
		theme.init();
		expect(theme.current).toBe('light');
	});

	it('reads "dark" theme from localStorage on init', async () => {
		localStorage.setItem(STORAGE_KEY, 'dark');
		const theme = await freshTheme();
		theme.init();
		expect(theme.current).toBe('dark');
	});

	it('reads "light" theme from localStorage on init', async () => {
		localStorage.setItem(STORAGE_KEY, 'light');
		// Make system dark to confirm localStorage wins
		vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
		const theme = await freshTheme();
		theme.init();
		expect(theme.current).toBe('light');
	});

	it('reads "nintendo-2001" theme from localStorage on init', async () => {
		localStorage.setItem(STORAGE_KEY, 'nintendo-2001');
		const theme = await freshTheme();
		theme.init();
		expect(theme.current).toBe('nintendo-2001');
	});

	it('defaults to dark when system prefers-color-scheme is dark and no stored preference', async () => {
		vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
		const theme = await freshTheme();
		theme.init();
		expect(theme.current).toBe('dark');
	});

	it('sets data-theme="light" on documentElement after init with light theme', async () => {
		const theme = await freshTheme();
		theme.init();
		expect(document.documentElement.getAttribute('data-theme')).toBe('light');
	});

	it('sets data-theme="dark" on documentElement after init with dark theme', async () => {
		localStorage.setItem(STORAGE_KEY, 'dark');
		const theme = await freshTheme();
		theme.init();
		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
	});

	it('exposes the list of available themes with ids and labels', async () => {
		const theme = await freshTheme();
		expect(theme.themes.map((t) => t.id)).toEqual(['light', 'dark', 'nintendo-2001']);
		for (const t of theme.themes) {
			expect(t.label).toBeTruthy();
		}
	});

	it('set() switches to the requested theme', async () => {
		const theme = await freshTheme();
		theme.init();
		theme.set('nintendo-2001');
		expect(theme.current).toBe('nintendo-2001');
	});

	it('set() persists the new theme to localStorage', async () => {
		const theme = await freshTheme();
		theme.init();
		theme.set('dark');
		expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
	});

	it('set() updates the data-theme attribute', async () => {
		const theme = await freshTheme();
		theme.init();
		theme.set('nintendo-2001');
		expect(document.documentElement.getAttribute('data-theme')).toBe('nintendo-2001');
	});

	it('set() ignores unknown theme ids', async () => {
		const theme = await freshTheme();
		theme.init();
		// @ts-expect-error deliberately passing an invalid id
		theme.set('banana');
		expect(theme.current).toBe('light');
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
	});

	it('toggle switches from light to dark', async () => {
		const theme = await freshTheme();
		theme.init();
		theme.toggle();
		expect(theme.current).toBe('dark');
	});

	it('toggle switches from dark back to light', async () => {
		localStorage.setItem(STORAGE_KEY, 'dark');
		const theme = await freshTheme();
		theme.init();
		theme.toggle();
		expect(theme.current).toBe('light');
	});

	it('toggle from nintendo-2001 goes to light', async () => {
		localStorage.setItem(STORAGE_KEY, 'nintendo-2001');
		const theme = await freshTheme();
		theme.init();
		theme.toggle();
		expect(theme.current).toBe('light');
	});

	it('persists new theme to localStorage on toggle', async () => {
		const theme = await freshTheme();
		theme.init();
		theme.toggle();
		expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
	});

	it('updates data-theme attribute on toggle', async () => {
		const theme = await freshTheme();
		theme.init();
		theme.toggle();
		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
	});

	it('ignores invalid values in localStorage and falls back to light', async () => {
		localStorage.setItem(STORAGE_KEY, 'banana');
		const theme = await freshTheme();
		theme.init();
		expect(theme.current).toBe('light');
	});
});
