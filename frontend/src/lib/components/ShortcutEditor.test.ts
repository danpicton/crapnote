import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, beforeEach } from 'vitest';
import ShortcutEditor from './ShortcutEditor.svelte';
import { shortcuts } from '$lib/stores/shortcuts.svelte';

beforeEach(() => {
	localStorage.clear();
	shortcuts.reset();
	shortcuts.load(1);
});

describe('ShortcutEditor', () => {
	it('lists each shortcut action with its current combo', () => {
		render(ShortcutEditor);
		expect(screen.getByText(/Create a new note/i)).toBeInTheDocument();
		expect(screen.getByText(/Focus the search box/i)).toBeInTheDocument();
	});

	it('has a record button per row', () => {
		render(ShortcutEditor);
		// 8 actions → 8 "record" buttons.
		expect(screen.getAllByRole('button', { name: /record/i })).toHaveLength(
			shortcuts.list.length
		);
	});

	it('captures a pressed key combo after clicking Record', async () => {
		render(ShortcutEditor);
		const row = screen.getByTestId('shortcut-row-new-note');
		const recordBtn = row.querySelector('button[data-role="record"]') as HTMLButtonElement;
		await fireEvent.click(recordBtn);

		// Now a keydown on the window should be captured.
		await fireEvent.keyDown(window, { key: 'm', altKey: true });

		expect(shortcuts.get('new-note')).toBe('Alt+M');
	});

	it('ignores modifier-only keydowns while recording', async () => {
		render(ShortcutEditor);
		const row = screen.getByTestId('shortcut-row-new-note');
		const recordBtn = row.querySelector('button[data-role="record"]') as HTMLButtonElement;
		await fireEvent.click(recordBtn);

		// Pressing just Control shouldn't commit — still waiting for a real key.
		await fireEvent.keyDown(window, { key: 'Control', ctrlKey: true });
		expect(shortcuts.get('new-note')).toBe('Ctrl+N'); // unchanged

		// Now press Ctrl+J — that commits.
		await fireEvent.keyDown(window, { key: 'j', ctrlKey: true });
		expect(shortcuts.get('new-note')).toBe('Ctrl+J');
	});

	it('resets a single shortcut to its default', async () => {
		shortcuts.setBinding('new-note', 'Alt+M');
		render(ShortcutEditor);
		const row = screen.getByTestId('shortcut-row-new-note');
		const resetBtn = row.querySelector('button[data-role="reset"]') as HTMLButtonElement;
		await fireEvent.click(resetBtn);
		expect(shortcuts.get('new-note')).toBe('Ctrl+N');
	});

	it('resets everything with the Reset all button', async () => {
		shortcuts.setBinding('new-note', 'Alt+M');
		shortcuts.setBinding('search-focus', 'Alt+F');
		render(ShortcutEditor);

		await fireEvent.click(screen.getByRole('button', { name: /reset all/i }));

		expect(shortcuts.get('new-note')).toBe('Ctrl+N');
		expect(shortcuts.get('search-focus')).toBe('Ctrl+K');
	});
});
