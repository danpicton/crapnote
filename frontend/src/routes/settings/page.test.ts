import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import SettingsPage from './+page.svelte';

vi.mock('$lib/stores/auth.svelte', () => ({
	auth: { user: { id: 1, username: 'alice', is_admin: false, created_at: '' } },
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

// vi.mock is hoisted; use vi.hoisted so mockTheme is available inside the factory.
const mockTheme = vi.hoisted(() => ({
	current: 'light' as 'light' | 'dark',
	toggle: vi.fn(),
	init: vi.fn(),
}));
vi.mock('$lib/stores/theme.svelte', () => ({ theme: mockTheme }));

describe('Settings page', () => {
	it('renders heading', () => {
		render(SettingsPage);
		expect(screen.getByRole('heading', { name: /settings/i })).toBeInTheDocument();
	});

	it('shows export notes button', () => {
		render(SettingsPage);
		expect(screen.getByRole('button', { name: /export notes/i })).toBeInTheDocument();
	});

	it('shows back link to notes', () => {
		render(SettingsPage);
		expect(screen.getByRole('link', { name: /back to notes/i })).toBeInTheDocument();
	});
});

describe('Settings — Appearance', () => {
	it('shows an Appearance section heading', () => {
		render(SettingsPage);
		expect(screen.getByRole('heading', { name: /appearance/i })).toBeInTheDocument();
	});

	it('shows a theme toggle button', () => {
		render(SettingsPage);
		expect(screen.getByRole('button', { name: /dark mode|light mode/i })).toBeInTheDocument();
	});

	it('labels the button "Enable dark mode" when theme is light', () => {
		mockTheme.current = 'light';
		render(SettingsPage);
		expect(screen.getByRole('button', { name: /enable dark mode/i })).toBeInTheDocument();
	});

	it('labels the button "Enable light mode" when theme is dark', () => {
		mockTheme.current = 'dark';
		render(SettingsPage);
		expect(screen.getByRole('button', { name: /enable light mode/i })).toBeInTheDocument();
	});

	it('calls theme.toggle() when the button is clicked', async () => {
		mockTheme.current = 'light';
		mockTheme.toggle = vi.fn();
		render(SettingsPage);
		await fireEvent.click(screen.getByRole('button', { name: /enable dark mode/i }));
		expect(mockTheme.toggle).toHaveBeenCalledOnce();
	});
});
