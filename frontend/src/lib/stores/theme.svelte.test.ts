import { describe, it, expect, beforeEach, vi } from 'vitest';

// Import AFTER stubbing globals so the module picks up the stubs.
// Each test re-initialises the store because Svelte runes are module-level state.
// We reset between tests by calling init() with fresh localStorage/matchMedia.

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

// The store fetches the admin-set global theme through the API client.
const mockApi = vi.hoisted(() => ({
	theme: {
		get: vi.fn().mockResolvedValue({ theme: '' }),
		setGlobal: vi.fn().mockResolvedValue(undefined),
	},
}));
vi.mock('$lib/api', () => ({ api: mockApi }));

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
		// Default: system prefers light, no global theme set
		vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
		mockApi.theme.get.mockReset().mockResolvedValue({ theme: '' });
		mockApi.theme.setGlobal.mockReset().mockResolvedValue(undefined);
	});

	it('defaults to light when localStorage is empty and system prefers light', async () => {
		const theme = await freshTheme();
		await theme.init();
		expect(theme.current).toBe('light');
	});

	it('reads "dark" theme from localStorage on init', async () => {
		localStorage.setItem(STORAGE_KEY, 'dark');
		const theme = await freshTheme();
		await theme.init();
		expect(theme.current).toBe('dark');
	});

	it('reads "light" theme from localStorage on init', async () => {
		localStorage.setItem(STORAGE_KEY, 'light');
		// Make system dark to confirm localStorage wins
		vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
		const theme = await freshTheme();
		await theme.init();
		expect(theme.current).toBe('light');
	});

	it('reads "console-2001" theme from localStorage on init', async () => {
		localStorage.setItem(STORAGE_KEY, 'console-2001');
		const theme = await freshTheme();
		await theme.init();
		expect(theme.current).toBe('console-2001');
	});

	it('reads "rosso" theme from localStorage on init', async () => {
		localStorage.setItem(STORAGE_KEY, 'rosso');
		const theme = await freshTheme();
		await theme.init();
		expect(theme.current).toBe('rosso');
	});

	it('reads "bianco" theme from localStorage on init', async () => {
		localStorage.setItem(STORAGE_KEY, 'bianco');
		const theme = await freshTheme();
		await theme.init();
		expect(theme.current).toBe('bianco');
	});

	it('reads "verdana" theme from localStorage on init', async () => {
		localStorage.setItem(STORAGE_KEY, 'verdana');
		const theme = await freshTheme();
		await theme.init();
		expect(theme.current).toBe('verdana');
	});

	it('reads "rawblock" theme from localStorage on init', async () => {
		localStorage.setItem(STORAGE_KEY, 'rawblock');
		const theme = await freshTheme();
		await theme.init();
		expect(theme.current).toBe('rawblock');
	});

	it('defaults to dark when system prefers-color-scheme is dark and no stored preference', async () => {
		vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
		const theme = await freshTheme();
		await theme.init();
		expect(theme.current).toBe('dark');
	});

	it('sets data-theme="light" on documentElement after init with light theme', async () => {
		const theme = await freshTheme();
		await theme.init();
		expect(document.documentElement.getAttribute('data-theme')).toBe('light');
	});

	it('sets data-theme="dark" on documentElement after init with dark theme', async () => {
		localStorage.setItem(STORAGE_KEY, 'dark');
		const theme = await freshTheme();
		await theme.init();
		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
	});

	it('exposes the list of available themes with ids and labels', async () => {
		const theme = await freshTheme();
		expect(theme.themes.map((t) => t.id)).toEqual(['light', 'dark', 'console-2001', 'rosso', 'bianco', 'rawblock', 'verdana']);
		expect(theme.themes.map((t) => t.label)).toEqual([
			'Claude',
			'Claude Dark',
			'Console 2001',
			'Rosso',
			'Bianco',
			'Rawblock',
			'Verdana',
		]);
	});

	it('set() switches to the requested theme', async () => {
		const theme = await freshTheme();
		await theme.init();
		theme.set('console-2001');
		expect(theme.current).toBe('console-2001');
	});

	it('set() persists the new theme to localStorage', async () => {
		const theme = await freshTheme();
		await theme.init();
		theme.set('dark');
		expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
	});

	it('set() updates the data-theme attribute', async () => {
		const theme = await freshTheme();
		await theme.init();
		theme.set('console-2001');
		expect(document.documentElement.getAttribute('data-theme')).toBe('console-2001');
	});

	it('set() ignores unknown theme ids', async () => {
		const theme = await freshTheme();
		await theme.init();
		// @ts-expect-error deliberately passing an invalid id
		theme.set('banana');
		expect(theme.current).toBe('light');
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
	});

	it('toggle switches from light to dark', async () => {
		const theme = await freshTheme();
		await theme.init();
		theme.toggle();
		expect(theme.current).toBe('dark');
	});

	it('toggle switches from dark back to light', async () => {
		localStorage.setItem(STORAGE_KEY, 'dark');
		const theme = await freshTheme();
		await theme.init();
		theme.toggle();
		expect(theme.current).toBe('light');
	});

	it('toggle from console-2001 goes to light', async () => {
		localStorage.setItem(STORAGE_KEY, 'console-2001');
		const theme = await freshTheme();
		await theme.init();
		theme.toggle();
		expect(theme.current).toBe('light');
	});

	it('persists new theme to localStorage on toggle', async () => {
		const theme = await freshTheme();
		await theme.init();
		theme.toggle();
		expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
	});

	it('updates data-theme attribute on toggle', async () => {
		const theme = await freshTheme();
		await theme.init();
		theme.toggle();
		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
	});

	it('ignores invalid values in localStorage and falls back to light', async () => {
		localStorage.setItem(STORAGE_KEY, 'banana');
		const theme = await freshTheme();
		await theme.init();
		expect(theme.current).toBe('light');
	});
});

describe('theme store — global (admin-set) theme', () => {
	beforeEach(() => {
		localStorage.clear();
		document.documentElement.removeAttribute('data-theme');
		vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
		mockApi.theme.get.mockReset().mockResolvedValue({ theme: '' });
		mockApi.theme.setGlobal.mockReset().mockResolvedValue(undefined);
	});

	it('applies the global theme on init when no user preference is stored', async () => {
		mockApi.theme.get.mockResolvedValue({ theme: 'rosso' });
		const theme = await freshTheme();
		await theme.init();
		expect(theme.current).toBe('rosso');
		expect(document.documentElement.getAttribute('data-theme')).toBe('rosso');
	});

	it('does NOT apply the global theme when the user has their own preference', async () => {
		localStorage.setItem(STORAGE_KEY, 'bianco');
		mockApi.theme.get.mockResolvedValue({ theme: 'rosso' });
		const theme = await freshTheme();
		await theme.init();
		expect(theme.current).toBe('bianco');
	});

	it('applying the global theme does not create a user preference', async () => {
		mockApi.theme.get.mockResolvedValue({ theme: 'rosso' });
		const theme = await freshTheme();
		await theme.init();
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
	});

	it('exposes the fetched global theme', async () => {
		mockApi.theme.get.mockResolvedValue({ theme: 'console-2001' });
		const theme = await freshTheme();
		await theme.init();
		expect(theme.globalTheme).toBe('console-2001');
	});

	it('ignores an unknown global theme id from the server', async () => {
		mockApi.theme.get.mockResolvedValue({ theme: 'mystery-brand' });
		const theme = await freshTheme();
		await theme.init();
		expect(theme.current).toBe('light');
		expect(theme.globalTheme).toBeNull();
	});

	it('survives a failed global-theme fetch (offline login screen)', async () => {
		mockApi.theme.get.mockRejectedValue(new Error('network down'));
		const theme = await freshTheme();
		await theme.init();
		expect(theme.current).toBe('light');
	});

	it('setGlobal() persists via the API and updates globalTheme', async () => {
		const theme = await freshTheme();
		await theme.init();
		await theme.setGlobal('rosso');
		expect(mockApi.theme.setGlobal).toHaveBeenCalledWith('rosso');
		expect(theme.globalTheme).toBe('rosso');
	});

	it('setGlobal() applies the theme locally when no user preference exists', async () => {
		const theme = await freshTheme();
		await theme.init();
		await theme.setGlobal('rosso');
		expect(theme.current).toBe('rosso');
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
	});

	it('setGlobal() leaves the current theme alone when a user preference exists', async () => {
		localStorage.setItem(STORAGE_KEY, 'bianco');
		const theme = await freshTheme();
		await theme.init();
		await theme.setGlobal('rosso');
		expect(theme.current).toBe('bianco');
	});
});
