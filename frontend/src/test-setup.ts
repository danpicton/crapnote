import '@testing-library/jest-dom';
import { vi } from 'vitest';

// jsdom doesn't implement window.matchMedia.  Default to desktop (matches: false)
// so tests that don't care about breakpoints behave like a desktop browser.
// Individual tests can override with vi.stubGlobal('matchMedia', ...).
Object.defineProperty(window, 'matchMedia', {
	writable: true,
	value: vi.fn().mockImplementation((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	})),
});
