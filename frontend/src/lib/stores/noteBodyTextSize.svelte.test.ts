import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function freshPreference() {
	vi.resetModules();
	const mod = await import('./noteBodyTextSize.svelte');
	return mod.noteBodyTextSize;
}

describe('note body text-size preference', () => {
	beforeEach(() => {
		localStorage.clear();
		document.documentElement.removeAttribute('data-note-body-size');
	});

	it('defaults to Medium and exposes exactly the four named choices', async () => {
		const preference = await freshPreference();

		expect(preference.current).toBe('medium');
		expect(preference.sizes).toEqual([
			{ id: 'small', label: 'Small' },
			{ id: 'medium', label: 'Medium' },
			{ id: 'large', label: 'Large' },
			{ id: 'x-large', label: 'X-large' },
		]);
	});

	it('applies and persists a selected named size', async () => {
		const preference = await freshPreference();

		preference.set('large');

		expect(preference.current).toBe('large');
		expect(localStorage.getItem('crapnote-note-body-text-size')).toBe('large');
		expect(document.documentElement).toHaveAttribute('data-note-body-size', 'large');
	});

	it('restores a persisted size on initialization', async () => {
		localStorage.setItem('crapnote-note-body-text-size', 'x-large');
		const preference = await freshPreference();

		preference.init();

		expect(preference.current).toBe('x-large');
		expect(document.documentElement).toHaveAttribute('data-note-body-size', 'x-large');
	});

	it('selecting Medium restores and persists the default size', async () => {
		const preference = await freshPreference();
		preference.set('large');

		preference.set('medium');

		expect(preference.current).toBe('medium');
		expect(localStorage.getItem('crapnote-note-body-text-size')).toBe('medium');
		expect(document.documentElement).toHaveAttribute('data-note-body-size', 'medium');
	});

	it('ignores invalid stored and selected values', async () => {
		localStorage.setItem('crapnote-note-body-text-size', 'huge');
		const preference = await freshPreference();
		preference.init();

		// @ts-expect-error exercising the runtime boundary
		preference.set('huge');

		expect(preference.current).toBe('medium');
		expect(document.documentElement).toHaveAttribute('data-note-body-size', 'medium');
		expect(localStorage.getItem('crapnote-note-body-text-size')).toBe('huge');
	});
});

describe('note body text-size preference with unavailable storage', () => {
	const realStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');

	afterEach(() => {
		if (realStorage) Object.defineProperty(window, 'localStorage', realStorage);
		localStorage.clear();
	});

	it('falls back safely when reading storage throws and still applies changes when writes throw', async () => {
		const boom = () => { throw new Error('SecurityError'); };
		Object.defineProperty(window, 'localStorage', {
			configurable: true,
			get: () => ({ getItem: boom, setItem: boom }),
		});
		const preference = await freshPreference();

		expect(() => preference.init()).not.toThrow();
		expect(preference.current).toBe('medium');
		expect(() => preference.set('small')).not.toThrow();
		expect(preference.current).toBe('small');
		expect(document.documentElement).toHaveAttribute('data-note-body-size', 'small');
	});

	it('falls back safely when accessing localStorage itself throws', async () => {
		Object.defineProperty(window, 'localStorage', {
			configurable: true,
			get: () => { throw new Error('SecurityError'); },
		});
		const preference = await freshPreference();

		expect(() => preference.init()).not.toThrow();
		expect(() => preference.set('x-large')).not.toThrow();
		expect(preference.current).toBe('x-large');
	});
});
