import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LoginPage from './+page.svelte';

// Mock the api module
vi.mock('$lib/api', () => ({
	api: {
		auth: {
			login: vi.fn(),
		},
	},
	ApiError: class ApiError extends Error {
		constructor(public status: number, message: string) {
			super(message);
		}
	},
}));

// Mock SvelteKit navigation
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
}));

import { api } from '$lib/api';
import { goto } from '$app/navigation';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('Login page', () => {
	it('renders username and password fields', () => {
		render(LoginPage);
		expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
		expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
	});

	it('calls api.auth.login with form values on submit', async () => {
		vi.mocked(api.auth.login).mockResolvedValueOnce({
			id: 1,
			username: 'alice',
			is_admin: false,
			created_at: '2024-01-01T00:00:00Z',
		});

		render(LoginPage);

		await fireEvent.input(screen.getByLabelText(/username/i), { target: { value: 'alice' } });
		await fireEvent.input(screen.getByLabelText(/password/i), { target: { value: 'secret' } });
		await fireEvent.click(screen.getByRole('button', { name: /log in/i }));

		await waitFor(() => {
			expect(api.auth.login).toHaveBeenCalledWith('alice', 'secret');
		});
	});

	it('navigates to / on successful login', async () => {
		vi.mocked(api.auth.login).mockResolvedValueOnce({
			id: 1,
			username: 'alice',
			is_admin: false,
			created_at: '2024-01-01T00:00:00Z',
		});

		render(LoginPage);

		await fireEvent.input(screen.getByLabelText(/username/i), { target: { value: 'alice' } });
		await fireEvent.input(screen.getByLabelText(/password/i), { target: { value: 'secret' } });
		await fireEvent.click(screen.getByRole('button', { name: /log in/i }));

		await waitFor(() => {
			expect(goto).toHaveBeenCalledWith('/');
		});
	});

	it('shows error message on login failure', async () => {
		const { ApiError } = await import('$lib/api');
		vi.mocked(api.auth.login).mockRejectedValueOnce(
			new ApiError(401, '{"error":"invalid credentials"}')
		);

		render(LoginPage);

		await fireEvent.input(screen.getByLabelText(/username/i), { target: { value: 'alice' } });
		await fireEvent.input(screen.getByLabelText(/password/i), { target: { value: 'wrong' } });
		await fireEvent.click(screen.getByRole('button', { name: /log in/i }));

		await waitFor(() => {
			expect(screen.getByRole('alert')).toBeInTheDocument();
		});
	});
});
