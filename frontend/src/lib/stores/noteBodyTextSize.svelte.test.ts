import { beforeEach, describe, expect, it, vi } from 'vitest';

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
});
