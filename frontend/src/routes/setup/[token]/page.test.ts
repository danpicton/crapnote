import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SetupPage from './+page.svelte';

const mockApi = vi.hoisted(() => ({
	setup: {
		get: vi.fn(),
		complete: vi.fn(),
	},
}));
vi.mock('$lib/api', () => ({
	api: mockApi,
	ApiError: class ApiError extends Error {
		constructor(public status: number, message: string) {
			super(message);
		}
	},
}));

const mockPage = vi.hoisted(() => ({ params: { token: 'abc123' } }));
vi.mock('$app/state', () => ({ page: mockPage }));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import { goto } from '$app/navigation';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('Setup page', () => {
	it('renders a Crapnote corner mark linking to home', async () => {
		mockApi.setup.get.mockResolvedValueOnce({ username: 'mallory', expires_at: '2030-01-01T00:00:00Z' });
		render(SetupPage);
		const link = screen.getByRole('link', { name: /crapnote/i });
		expect(link).toBeInTheDocument();
		expect(link).toHaveAttribute('href', '/');
	});

	it('fetches the token metadata on load and shows the username', async () => {
		mockApi.setup.get.mockResolvedValueOnce({
			username: 'mallory',
			expires_at: '2030-01-01T00:00:00Z',
		});

		render(SetupPage);
		await waitFor(() => {
			expect(screen.getByText(/mallory/i)).toBeInTheDocument();
		});
		expect(mockApi.setup.get).toHaveBeenCalledWith('abc123');
	});

	it('submits the new password when the form is filled correctly', async () => {
		mockApi.setup.get.mockResolvedValueOnce({
			username: 'mallory',
			expires_at: '2030-01-01T00:00:00Z',
		});
		mockApi.setup.complete.mockResolvedValueOnce(undefined);

		render(SetupPage);
		await waitFor(() => screen.getByText(/mallory/i));

		await fireEvent.input(screen.getByLabelText('New password'), {
			target: { value: 'brand-new-password-1234' },
		});
		await fireEvent.input(screen.getByLabelText(/confirm new password/i), {
			target: { value: 'brand-new-password-1234' },
		});
		await fireEvent.click(screen.getByRole('button', { name: /set password/i }));

		await waitFor(() => {
			expect(mockApi.setup.complete).toHaveBeenCalledWith('abc123', 'brand-new-password-1234');
		});
	});

	it('shows an error and does not submit when passwords differ', async () => {
		mockApi.setup.get.mockResolvedValueOnce({
			username: 'mallory',
			expires_at: '2030-01-01T00:00:00Z',
		});
		render(SetupPage);
		await waitFor(() => screen.getByText(/mallory/i));

		await fireEvent.input(screen.getByLabelText('New password'), {
			target: { value: 'brand-new-password-1234' },
		});
		await fireEvent.input(screen.getByLabelText(/confirm new password/i), {
			target: { value: 'different-xyz-1234' },
		});
		await fireEvent.click(screen.getByRole('button', { name: /set password/i }));

		expect(screen.getByRole('alert').textContent).toMatch(/match/i);
		expect(mockApi.setup.complete).not.toHaveBeenCalled();
	});

	it('shows an invalid-link message when the token lookup returns 404', async () => {
		const { ApiError } = await import('$lib/api');
		mockApi.setup.get.mockRejectedValueOnce(new ApiError(404, '{}'));

		render(SetupPage);
		await waitFor(() => {
			expect(screen.getByRole('alert').textContent).toMatch(/invalid|expired/i);
		});
	});

	it('navigates to /login after a successful setup', async () => {
		mockApi.setup.get.mockResolvedValueOnce({
			username: 'mallory',
			expires_at: '2030-01-01T00:00:00Z',
		});
		mockApi.setup.complete.mockResolvedValueOnce(undefined);

		render(SetupPage);
		await waitFor(() => screen.getByText(/mallory/i));

		await fireEvent.input(screen.getByLabelText('New password'), {
			target: { value: 'brand-new-password-1234' },
		});
		await fireEvent.input(screen.getByLabelText(/confirm new password/i), {
			target: { value: 'brand-new-password-1234' },
		});
		await fireEvent.click(screen.getByRole('button', { name: /set password/i }));

		await waitFor(() => {
			expect(goto).toHaveBeenCalledWith('/login');
		});
	});
});
