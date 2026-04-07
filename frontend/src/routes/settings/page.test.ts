import { render, screen } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import SettingsPage from './+page.svelte';

vi.mock('$lib/stores/auth.svelte', () => ({
	auth: { user: { id: 1, username: 'alice', is_admin: false, created_at: '' } },
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

describe('Settings page', () => {
	it('renders heading', () => {
		render(SettingsPage);
		expect(screen.getByRole('heading', { name: /settings/i })).toBeInTheDocument();
	});

	it('shows export notes button', () => {
		render(SettingsPage);
		expect(screen.getByRole('link', { name: /export notes/i })).toBeInTheDocument();
	});

	it('shows back link to notes', () => {
		render(SettingsPage);
		expect(screen.getByRole('link', { name: /← notes/i })).toBeInTheDocument();
	});
});
