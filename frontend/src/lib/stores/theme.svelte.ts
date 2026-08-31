import { api } from '$lib/api';

const STORAGE_KEY = 'crapnote-theme';

export type ThemeId = 'light' | 'dark' | 'console-2001' | 'rosso' | 'bianco' | 'rawblock' | 'verdana';

export interface ThemeOption {
	id: ThemeId;
	label: string;
}

const THEMES: ThemeOption[] = [
	{ id: 'light', label: 'Claude' },
	{ id: 'dark', label: 'Claude Dark' },
	{ id: 'console-2001', label: 'Console 2001' },
	{ id: 'rosso', label: 'Rosso' },
	{ id: 'bianco', label: 'Bianco' },
	{ id: 'rawblock', label: 'Rawblock' },
	{ id: 'verdana', label: 'Verdana' },
];

function isThemeId(value: unknown): value is ThemeId {
	return THEMES.some((t) => t.id === value);
}

function createThemeStore() {
	let current = $state<ThemeId>('light');
	let globalTheme = $state<ThemeId | null>(null);

	// Bumped every time setGlobal() writes the global theme. init() snapshots it
	// before its fetch starts and discards the response if the count has moved
	// on, so a slow GET can never resurrect a value the admin has just replaced.
	// A counter rather than a "has ever been written" flag: the test is whether
	// *this* fetch is older than the latest write, so an init() started after a
	// save is still free to apply what it reads.
	let globalWrites = 0;

	function applyToDOM(t: ThemeId) {
		document.documentElement.setAttribute('data-theme', t);
		syncBrowserThemeColor();
	}

	/**
	 * Keep <meta name="theme-color"> in step with the active theme so the
	 * browser chrome — and the status bar of the installed PWA — matches the
	 * app instead of staying on the light theme's cream.
	 *
	 * The value is read back from the computed --bg rather than duplicated in a
	 * lookup table here, so adding a theme to app.html is all it takes.
	 */
	function syncBrowserThemeColor() {
		const meta = document.querySelector('meta[name="theme-color"]');
		if (!meta) return;
		const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
		// Empty before the stylesheet has applied — leave the markup default in
		// place rather than blanking it.
		if (bg) meta.setAttribute('content', bg);
	}

	// A user-level preference exists only when the user has explicitly picked
	// a theme on this device (set() writes it). Without one, the admin-chosen
	// global theme applies.
	function hasUserPreference(): boolean {
		return isThemeId(localStorage.getItem(STORAGE_KEY));
	}

	/**
	 * Resolve the initial theme.  Priority order:
	 *   1. Stored user preference in localStorage (survives logout, so a
	 *      returning user's login screen keeps their theme)
	 *   2. Admin-set global theme from the server
	 *   3. OS prefers-color-scheme
	 *   4. Default: light
	 *
	 * Local sources apply synchronously so first paint never waits on the
	 * network; the global theme lands when the fetch resolves.
	 */
	async function init() {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (isThemeId(stored)) {
			current = stored;
		} else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
			current = 'dark';
		} else {
			current = 'light';
		}
		applyToDOM(current);

		const writesAtFetch = globalWrites;
		try {
			const { theme: global } = await api.theme.get();
			// A setGlobal() landed while this was in flight; its value is newer.
			if (globalWrites !== writesAtFetch) return;
			if (isThemeId(global)) {
				globalTheme = global;
				if (!hasUserPreference()) {
					current = global;
					applyToDOM(current);
				}
			}
		} catch {
			// Offline or server error — the local fallback already applied.
		}
	}

	function set(id: ThemeId) {
		if (!isThemeId(id)) return;
		current = id;
		localStorage.setItem(STORAGE_KEY, current);
		applyToDOM(current);
	}

	/** Persist the global default (admin only) and apply it locally unless
	 *  this device has its own user-level preference. */
	async function setGlobal(id: ThemeId) {
		if (!isThemeId(id)) return;
		await api.theme.setGlobal(id);
		globalWrites++;
		globalTheme = id;
		if (!hasUserPreference()) {
			current = id;
			applyToDOM(current);
		}
	}

	/** Cycle light ↔ dark; any other theme returns to light. */
	function toggle() {
		set(current === 'light' ? 'dark' : 'light');
	}

	return {
		get current() { return current; },
		get globalTheme() { return globalTheme; },
		get themes() { return THEMES; },
		init,
		set,
		setGlobal,
		toggle,
	};
}

export const theme = createThemeStore();
