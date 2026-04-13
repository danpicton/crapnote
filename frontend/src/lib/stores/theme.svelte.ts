const STORAGE_KEY = 'crapnote-theme';
type Theme = 'light' | 'dark';

function createThemeStore() {
	let current = $state<Theme>('light');

	function applyToDOM(t: Theme) {
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
		if (stored === 'light' || stored === 'dark') {
			current = stored;
		} else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
			current = 'dark';
		} else {
			current = 'light';
		}
		applyToDOM(current);
	}

	function toggle() {
		current = current === 'light' ? 'dark' : 'light';
		localStorage.setItem(STORAGE_KEY, current);
		applyToDOM(current);
	}

	return {
		get current() { return current; },
		init,
		toggle,
	};
}

export const theme = createThemeStore();
