import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ShortcutHelp from './ShortcutHelp.svelte';
import { shortcuts } from '$lib/stores/shortcuts.svelte';

beforeEach(() => {
	localStorage.clear();
	shortcuts.reset();
	shortcuts.load(1);
});

describe('ShortcutHelp', () => {
	it('does not render when closed', () => {
		render(ShortcutHelp, { open: false, onclose: vi.fn() });
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});

	it('renders a dialog listing shortcuts when open', () => {
		render(ShortcutHelp, { open: true, onclose: vi.fn() });
		expect(screen.getByRole('dialog')).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: /keyboard shortcuts/i })).toBeInTheDocument();
		// Should list a few known actions.
		expect(screen.getByText(/Create a new note/i)).toBeInTheDocument();
		expect(screen.getByText(/Focus the search box/i)).toBeInTheDocument();
	});

	it('calls onclose when the close button is clicked', async () => {
		const onclose = vi.fn();
		render(ShortcutHelp, { open: true, onclose });
		await fireEvent.click(screen.getByRole('button', { name: /close/i }));
		expect(onclose).toHaveBeenCalled();
	});

	it('calls onclose when Escape is pressed', async () => {
		const onclose = vi.fn();
		render(ShortcutHelp, { open: true, onclose });
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(onclose).toHaveBeenCalled();
	});
});
