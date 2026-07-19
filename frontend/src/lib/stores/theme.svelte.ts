const STORAGE_KEY = 'crapnote-theme';

export type ThemeId = 'light' | 'dark' | 'console-2001' | 'rosso';

export interface ThemeOption {
	id: ThemeId;
	label: string;
}

const THEMES: ThemeOption[] = [
	{ id: 'light', label: 'Claude' },
	{ id: 'dark', label: 'Claude Dark' },
	{ id: 'console-2001', label: 'Console 2001' },
	{ id: 'rosso', label: 'Rosso' },
];

function isThemeId(value: unknown): value is ThemeId {
	return THEMES.some((t) => t.id === value);
}

function createThemeStore() {
	let current = $state<ThemeId>('light');

	function applyToDOM(t: ThemeId) {
		document.documentElement.setAttribute('data-theme', t);
	}

	/**
	 * Resolve the initial theme.  Priority order:
	 *   1. Stored user preference in localStorage
	 *   2. OS prefers-color-scheme
	 *   3. Default: light
	 */
	function init() {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (isThemeId(stored)) {
			current = stored;
		} else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
			current = 'dark';
		} else {
			current = 'light';
		}
		applyToDOM(current);
	}

	function set(id: ThemeId) {
		if (!isThemeId(id)) return;
		current = id;
		localStorage.setItem(STORAGE_KEY, current);
		applyToDOM(current);
	}

	/** Cycle light ↔ dark; any other theme returns to light. */
	function toggle() {
		set(current === 'light' ? 'dark' : 'light');
	}

	return {
		get current() { return current; },
		get themes() { return THEMES; },
		init,
		set,
		toggle,
	};
}

export const theme = createThemeStore();
