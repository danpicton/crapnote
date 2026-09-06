import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

	// A GET that was already in flight when the admin saved carries a value the
	// admin has just replaced; letting it land makes the save look like it
	// silently failed even though the server stored the new theme.
	it('a slow init() fetch does not revert a global theme saved while it was in flight', async () => {
		let resolveGet!: (value: { theme: string }) => void;
		mockApi.theme.get.mockReturnValue(
			new Promise<{ theme: string }>((resolve) => {
				resolveGet = resolve;
			}),
		);

		const theme = await freshTheme();
		const initDone = theme.init();

		await theme.setGlobal('rosso');
		expect(theme.current).toBe('rosso');

		resolveGet({ theme: 'bianco' });
		await initDone;

		expect(theme.globalTheme).toBe('rosso');
		expect(theme.current).toBe('rosso');
		expect(document.documentElement.getAttribute('data-theme')).toBe('rosso');
	});

	// Same race, but on a device that has its own theme: globalTheme must still
	// be protected even though `current` was never the global theme's to change.
	it('a slow init() fetch does not revert globalTheme when the user has a preference', async () => {
		localStorage.setItem(STORAGE_KEY, 'bianco');
		let resolveGet!: (value: { theme: string }) => void;
		mockApi.theme.get.mockReturnValue(
			new Promise<{ theme: string }>((resolve) => {
				resolveGet = resolve;
			}),
		);

		const theme = await freshTheme();
		const initDone = theme.init();

		await theme.setGlobal('rosso');

		resolveGet({ theme: 'verdana' });
		await initDone;

		expect(theme.globalTheme).toBe('rosso');
		expect(theme.current).toBe('bianco');
		expect(document.documentElement.getAttribute('data-theme')).toBe('bianco');
	});

	// The guard keys on the fetch being older than the write, not on a write
	// having ever happened — a fetch started afterwards is the fresher source.
	it('an init() started after setGlobal() still applies the fetched global theme', async () => {
		const theme = await freshTheme();
		await theme.init();
		await theme.setGlobal('rosso');

		mockApi.theme.get.mockResolvedValue({ theme: 'bianco' });
		await theme.init();

		expect(theme.globalTheme).toBe('bianco');
		expect(theme.current).toBe('bianco');
		expect(document.documentElement.getAttribute('data-theme')).toBe('bianco');
	});

	it('an in-flight fetch that rejects after setGlobal() leaves the saved theme alone', async () => {
		let rejectGet!: (reason: Error) => void;
		mockApi.theme.get.mockReturnValue(
			new Promise<{ theme: string }>((_resolve, reject) => {
				rejectGet = reject;
			}),
		);

		const theme = await freshTheme();
		const initDone = theme.init();

		await theme.setGlobal('rosso');

		rejectGet(new Error('network down'));
		await initDone;

		expect(theme.globalTheme).toBe('rosso');
		expect(theme.current).toBe('rosso');
	});

	// Two saves in flight at once: the newest pick is the one the admin last
	// asked for, so an older save that settles afterwards must not apply its
	// value — the settings select follows globalTheme, so a late older write
	// would visibly move it back off the newer pick even while that newer
	// save is still in flight (or has since failed).
	it('an older save that succeeds while a newer save is pending does not apply its value', async () => {
		let resolveRosso!: () => void;
		let resolveBianco!: () => void;
		mockApi.theme.setGlobal.mockImplementation((id: string) =>
			id === 'rosso'
				? new Promise<void>((resolve) => {
						resolveRosso = resolve;
					})
				: new Promise<void>((resolve) => {
						resolveBianco = resolve;
					}),
		);

		const theme = await freshTheme();
		await theme.init();

		const saveRosso = theme.setGlobal('rosso'); // picked first, slow
		const saveBianco = theme.setGlobal('bianco'); // picked second
		// Saves are queued behind the previous one, so flush the queue so the
		// mock's handles are installed before they are released below.
		await Promise.resolve();

		// The older request's PUT settles first. It succeeded — but a newer
		// pick is pending, so applying it would flash 'rosso' over 'bianco'.
		resolveRosso();
		await saveRosso;
		expect(theme.globalTheme).toBeNull();
		expect(theme.current).toBe('light');

		resolveBianco();
		await saveBianco;
		expect(theme.globalTheme).toBe('bianco');
		expect(theme.current).toBe('bianco');
		expect(document.documentElement.getAttribute('data-theme')).toBe('bianco');
	});

	// The same stale-success window, but the newer save fails. The stale value
	// must still not land: the newer pick's failure owns the UI (its caller
	// shows the error), and the select must not be dragged to a value the
	// admin has already moved past.
	it('an older save does not apply once a newer save has failed', async () => {
		let resolveRosso!: () => void;
		mockApi.theme.setGlobal.mockImplementation((id: string) =>
			id === 'rosso'
				? new Promise<void>((resolve) => {
						resolveRosso = resolve;
					})
				: Promise.reject(new Error('boom')),
		);

		const theme = await freshTheme();
		await theme.init();

		const saveRosso = theme.setGlobal('rosso'); // picked first, slow
		const saveBianco = theme.setGlobal('bianco'); // picked second, fails
		await Promise.resolve();

		resolveRosso(); // the older success lands first...
		await saveRosso;
		// ...and must not apply anything: bianco's outcome owns the UI.
		expect(theme.globalTheme).toBeNull();
		expect(theme.current).toBe('light');

		// The newer save then fails, surfaced to its caller (the settings
		// page shows the error and reverts the select to theme.globalTheme —
		// still the old value, never the stale 'rosso').
		await expect(saveBianco).rejects.toThrow('boom');
		expect(theme.globalTheme).toBeNull();
		expect(theme.current).toBe('light');
	});

	// The guard is about ordering, not about suppressing everything that
	// overlaps: a newer save that lands last is still the one that applies.
	it('a newer setGlobal() still applies when it resolves after an older one', async () => {
		let resolveSecond!: () => void;
		mockApi.theme.setGlobal.mockImplementation((id: string) =>
			id === 'verdana'
				? new Promise<void>((resolve) => {
						resolveSecond = resolve;
					})
				: Promise.resolve(undefined),
		);

		const theme = await freshTheme();
		await theme.setGlobal('bianco');
		const second = theme.setGlobal('verdana');
		await Promise.resolve();

		expect(theme.globalTheme).toBe('bianco');
		resolveSecond();
		await second;

		expect(theme.globalTheme).toBe('verdana');
	});

	// Two PUTs sent concurrently can reach a last-write-wins backend in the
	// wrong order and leave the *older* pick persisted, making the client's
	// claim that the newer pick won a lie until the next reload. Saves are
	// therefore serialised: a newer save's PUT waits for the earlier one to
	// settle (success or failure) before it is sent.
	it('sends saves to the server in the order they were picked', async () => {
		let resolveRosso!: () => void;
		mockApi.theme.setGlobal.mockImplementation((id: string) =>
			id === 'rosso'
				? new Promise<void>((resolve) => {
						resolveRosso = resolve;
					})
				: Promise.resolve(undefined),
		);

		const theme = await freshTheme();
		await theme.init();

		const saveRosso = theme.setGlobal('rosso'); // picked first, slow
		const saveBianco = theme.setGlobal('bianco'); // picked second
		await Promise.resolve();

		// While the first PUT is outstanding the second must not be on the
		// wire yet — a concurrent pair could commit in the wrong order.
		expect(mockApi.theme.setGlobal).toHaveBeenCalledTimes(1);

		resolveRosso();
		await saveRosso;
		await saveBianco;

		expect(mockApi.theme.setGlobal.mock.calls.map(([id]) => id)).toEqual(['rosso', 'bianco']);
		expect(theme.globalTheme).toBe('bianco');
	});

	// A failure of one save must not block the chain: the newer pick still
	// needs to reach the server even if the one before it failed.
	it('a failed save does not stop the newer save from being sent', async () => {
		let rejectRosso!: (reason: Error) => void;
		mockApi.theme.setGlobal.mockImplementation((id: string) =>
			id === 'rosso'
				? new Promise<void>((_resolve, reject) => {
						rejectRosso = reject;
					})
				: Promise.resolve(undefined),
		);

		const theme = await freshTheme();
		await theme.init();

		const saveRosso = theme.setGlobal('rosso'); // picked first, will fail
		const saveBianco = theme.setGlobal('bianco'); // picked second
		await Promise.resolve();

		expect(mockApi.theme.setGlobal).toHaveBeenCalledTimes(1);

		rejectRosso(new Error('network down'));
		await expect(saveRosso).rejects.toThrow('network down');
		await saveBianco;

		expect(mockApi.theme.setGlobal.mock.calls.map(([id]) => id)).toEqual(['rosso', 'bianco']);
		expect(theme.globalTheme).toBe('bianco');
	});
});

describe('browser theme-color', () => {
	function setup() {
		document.head.innerHTML = `
			<meta name="theme-color" content="#faf8f4" />
			<style>
				:root { --bg: #faf8f4; }
				[data-theme="dark"] { --bg: #141210; }
				[data-theme="rosso"] { --bg: #181818; }
				[data-theme="verdana"] { --bg: #f8fafc; }
			</style>`;
	}

	function themeColor(): string | null {
		return document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null;
	}

	beforeEach(() => {
		localStorage.clear();
		document.documentElement.removeAttribute('data-theme');
		setup();
	});

	it('follows the active theme so the status bar matches the app', async () => {
		const theme = await freshTheme();
		await theme.init();

		theme.set('dark');
		expect(themeColor()).toBe('#141210');

		theme.set('rosso');
		expect(themeColor()).toBe('#181818');

		theme.set('verdana');
		expect(themeColor()).toBe('#f8fafc');
	});

	it('is applied on init, not just on later changes', async () => {
		localStorage.setItem(STORAGE_KEY, 'rosso');
		const theme = await freshTheme();
		await theme.init();

		expect(themeColor()).toBe('#181818');
	});

	it('leaves the existing value alone when no meta tag is present', async () => {
		document.head.innerHTML = '<style>:root { --bg: #faf8f4; }</style>';
		const theme = await freshTheme();
		await theme.init();

		// Nothing to update, and crucially nothing thrown.
		expect(document.querySelector('meta[name="theme-color"]')).toBeNull();
	});
})

// Safari private browsing and policy-disabled storage both make localStorage
// throw rather than return null. Persistence is best-effort; the theme itself
// must still apply for the session.
describe('theme store — storage unavailable', () => {
	const realStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');

	/** localStorage is present but every read/write throws (Safari private browsing). */
	function breakStorageMethods() {
		const boom = () => {
			throw new Error('SecurityError: the operation is insecure');
		};
		Object.defineProperty(window, 'localStorage', {
			configurable: true,
			get: () => ({ getItem: boom, setItem: boom, removeItem: boom, clear: boom }),
		});
	}

	/** Reaching the property at all throws (storage disabled by policy). */
	function breakStorageProperty() {
		Object.defineProperty(window, 'localStorage', {
			configurable: true,
			get() {
				throw new Error('SecurityError: access to storage is denied');
			},
		});
	}

	beforeEach(() => {
		localStorage.clear();
		document.documentElement.removeAttribute('data-theme');
		vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
		mockApi.theme.get.mockReset().mockResolvedValue({ theme: '' });
		mockApi.theme.setGlobal.mockReset().mockResolvedValue(undefined);
	});

	afterEach(() => {
		if (realStorage) Object.defineProperty(window, 'localStorage', realStorage);
		localStorage.clear();
	});

	it('set() still applies the theme when persisting throws', async () => {
		const theme = await freshTheme();
		await theme.init();

		breakStorageMethods();
		theme.set('rosso');

		expect(theme.current).toBe('rosso');
		expect(document.documentElement.getAttribute('data-theme')).toBe('rosso');
	});

	it('set() does not throw when persisting throws', async () => {
		const theme = await freshTheme();
		await theme.init();

		breakStorageMethods();
		expect(() => theme.set('dark')).not.toThrow();
	});

	it('set() still applies the theme when touching localStorage throws', async () => {
		const theme = await freshTheme();
		await theme.init();

		breakStorageProperty();
		theme.set('rosso');

		expect(theme.current).toBe('rosso');
		expect(document.documentElement.getAttribute('data-theme')).toBe('rosso');
	});

	it('init() falls back to the OS preference when reads throw', async () => {
		vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
		breakStorageMethods();

		const theme = await freshTheme();
		await expect(theme.init()).resolves.toBeUndefined();

		expect(theme.current).toBe('dark');
		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
	});

	it('init() falls back to the OS preference when touching localStorage throws', async () => {
		vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
		breakStorageProperty();

		const theme = await freshTheme();
		await expect(theme.init()).resolves.toBeUndefined();

		expect(theme.current).toBe('dark');
		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
	});

	// Unreadable storage means no user preference can exist on this device, so
	// the admin's global theme is still the right thing to apply.
	it('init() still applies the global theme when reads throw', async () => {
		mockApi.theme.get.mockResolvedValue({ theme: 'rosso' });
		breakStorageMethods();

		const theme = await freshTheme();
		await theme.init();

		expect(theme.current).toBe('rosso');
		expect(document.documentElement.getAttribute('data-theme')).toBe('rosso');
	});

	it('setGlobal() still applies the saved theme when reads throw', async () => {
		breakStorageMethods();

		const theme = await freshTheme();
		await theme.init();
		await theme.setGlobal('bianco');

		expect(theme.current).toBe('bianco');
		expect(document.documentElement.getAttribute('data-theme')).toBe('bianco');
	});
});
