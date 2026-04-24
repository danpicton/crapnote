import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SettingsPage from './+page.svelte';

const mockApi = vi.hoisted(() => ({
	auth: { changePassword: vi.fn() },
	tokens: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock('$lib/api', () => ({
	api: mockApi,
	ApiError: class ApiError extends Error {
		constructor(public status: number, message: string) {
			super(message);
		}
	},
}));

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

describe('Settings — Change password', () => {
	beforeEach(() => {
		mockApi.auth.changePassword.mockReset();
	});

	it('shows a change password section', () => {
		render(SettingsPage);
		expect(screen.getByRole('heading', { name: /change password/i })).toBeInTheDocument();
	});

	it('calls api.auth.changePassword when both fields match', async () => {
		mockApi.auth.changePassword.mockResolvedValueOnce(undefined);
		render(SettingsPage);

		await fireEvent.input(screen.getByLabelText(/current password/i), {
			target: { value: 'oldpassword12' },
		});
		await fireEvent.input(screen.getByLabelText('New password'), {
			target: { value: 'newpassword345' },
		});
		await fireEvent.input(screen.getByLabelText(/confirm new password/i), {
			target: { value: 'newpassword345' },
		});
		await fireEvent.click(screen.getByRole('button', { name: /update password/i }));

		await waitFor(() => {
			expect(mockApi.auth.changePassword).toHaveBeenCalledWith('oldpassword12', 'newpassword345');
		});
	});

	it('rejects when the new password and confirmation differ', async () => {
		render(SettingsPage);

		await fireEvent.input(screen.getByLabelText(/current password/i), {
			target: { value: 'oldpassword12' },
		});
		await fireEvent.input(screen.getByLabelText('New password'), {
			target: { value: 'newpassword345' },
		});
		await fireEvent.input(screen.getByLabelText(/confirm new password/i), {
			target: { value: 'something-else' },
		});
		await fireEvent.click(screen.getByRole('button', { name: /update password/i }));

		await waitFor(() => {
			expect(screen.getByRole('alert').textContent).toMatch(/match/i);
		});
		expect(mockApi.auth.changePassword).not.toHaveBeenCalled();
	});

	it('shows an error when the current password is wrong', async () => {
		const { ApiError } = await import('$lib/api');
		mockApi.auth.changePassword.mockRejectedValueOnce(new ApiError(403, '{}'));
		render(SettingsPage);

		await fireEvent.input(screen.getByLabelText(/current password/i), {
			target: { value: 'wrong12345678' },
		});
		await fireEvent.input(screen.getByLabelText('New password'), {
			target: { value: 'newpassword345' },
		});
		await fireEvent.input(screen.getByLabelText(/confirm new password/i), {
			target: { value: 'newpassword345' },
		});
		await fireEvent.click(screen.getByRole('button', { name: /update password/i }));

		await waitFor(() => {
			expect(screen.getByRole('alert').textContent).toMatch(/incorrect/i);
		});
	});

	it('rejects new passwords shorter than 12 characters client-side', async () => {
		render(SettingsPage);
		await fireEvent.input(screen.getByLabelText(/current password/i), {
			target: { value: 'oldpassword12' },
		});
		await fireEvent.input(screen.getByLabelText('New password'), {
			target: { value: 'short' },
		});
		await fireEvent.input(screen.getByLabelText(/confirm new password/i), {
			target: { value: 'short' },
		});
		await fireEvent.click(screen.getByRole('button', { name: /update password/i }));

		await waitFor(() => {
			expect(screen.getByRole('alert').textContent).toMatch(/12 characters/i);
		});
		expect(mockApi.auth.changePassword).not.toHaveBeenCalled();
	});
});
