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
	OfflineError: class OfflineError extends Error {
		public status = 503;
		constructor(message = 'offline') {
			super(message);
		}
	},
}));

// Mock SvelteKit navigation
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
}));

// Spread the originals: the real auth store is under test here too, and it
// imports the rest of both modules.
vi.mock('$lib/localData', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/localData')>()),
	readSessionUser: vi.fn().mockReturnValue(null),
}));
vi.mock('$lib/offlineUnlock', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/offlineUnlock')>()),
	hasUnlockPasscode: vi.fn().mockReturnValue(false),
	storeUnlockPasscode: vi.fn().mockResolvedValue(undefined),
	markIdentityProved: vi.fn().mockResolvedValue(undefined),
}));

import { api } from '$lib/api';
import { goto } from '$app/navigation';
import { readSessionUser } from '$lib/localData';
import { hasUnlockPasscode } from '$lib/offlineUnlock';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('Login page', () => {
	it('renders username and password fields', () => {
		render(LoginPage);
		expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
		expect(screen.getByLabelText('Password')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
	});

	it('has a show-password toggle that reveals the password', async () => {
		render(LoginPage);
		const field = screen.getByLabelText('Password') as HTMLInputElement;
		expect(field.type).toBe('password');
		await fireEvent.click(screen.getByRole('button', { name: /show password/i }));
		expect(field.type).toBe('text');
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
		await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'secret' } });
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
		await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'secret' } });
		await fireEvent.click(screen.getByRole('button', { name: /log in/i }));

		await waitFor(() => {
			expect(goto).toHaveBeenCalledWith('/');
		});
	});

	it('shows a locked-account message on 403', async () => {
		const { ApiError } = await import('$lib/api');
		vi.mocked(api.auth.login).mockRejectedValueOnce(
			new ApiError(403, '{"error":"account locked"}')
		);

		render(LoginPage);

		await fireEvent.input(screen.getByLabelText(/username/i), { target: { value: 'alice' } });
		await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'right' } });
		await fireEvent.click(screen.getByRole('button', { name: /log in/i }));

		await waitFor(() => {
			expect(screen.getByRole('alert').textContent).toMatch(/locked/i);
		});
	});

	it('shows error message on login failure', async () => {
		const { ApiError } = await import('$lib/api');
		vi.mocked(api.auth.login).mockRejectedValueOnce(
			new ApiError(401, '{"error":"invalid credentials"}')
		);

		render(LoginPage);

		await fireEvent.input(screen.getByLabelText(/username/i), { target: { value: 'alice' } });
		await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
		await fireEvent.click(screen.getByRole('button', { name: /log in/i }));

		await waitFor(() => {
			expect(screen.getByRole('alert')).toBeInTheDocument();
		});
	});
});

describe('Pending share', () => {
	it('returns to the share handler after signing in', async () => {
		const { PENDING_SHARE_KEY } = await import('$lib/share');
		sessionStorage.setItem(PENDING_SHARE_KEY, JSON.stringify({ text: 'shared thing' }));
		vi.mocked(api.auth.login).mockResolvedValue({
			id: 1, username: 'alice', is_admin: false, created_at: '2024-01-01T00:00:00Z',
		});

		render(LoginPage);
		await fireEvent.input(screen.getByLabelText(/username/i), { target: { value: 'u' } });
		await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'p' } });
		await fireEvent.click(screen.getByRole('button', { name: /log in/i }));

		await waitFor(() => expect(goto).toHaveBeenCalledWith('/share?restore=1'));
		sessionStorage.clear();
	});

	it('goes to the notes list when no share is pending', async () => {
		sessionStorage.clear();
		vi.mocked(api.auth.login).mockResolvedValue({
			id: 1, username: 'alice', is_admin: false, created_at: '2024-01-01T00:00:00Z',
		});

		render(LoginPage);
		await fireEvent.input(screen.getByLabelText(/username/i), { target: { value: 'u' } });
		await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'p' } });
		await fireEvent.click(screen.getByRole('button', { name: /log in/i }));

		await waitFor(() => expect(goto).toHaveBeenCalledWith('/'));
	});
});

describe('Login page offline', () => {
	it('shows an offline message rather than "invalid credentials" when the network is down', async () => {
		const { OfflineError } = await import('$lib/api');
		vi.mocked(api.auth.login).mockRejectedValue(new OfflineError());

		render(LoginPage);
		await fireEvent.input(screen.getByLabelText(/username/i), { target: { value: 'alice' } });
		await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'pw' } });
		await fireEvent.click(screen.getByRole('button', { name: /log in/i }));

		await waitFor(() => expect(screen.getByText(/you're offline/i)).toBeInTheDocument());
		expect(screen.queryByText(/invalid username or password/i)).not.toBeInTheDocument();
	});
});


/**
 * Someone can land here holding cached notes they cannot reach. Saying so on
 * arrival matters: the explanation used to be reachable only by filling in
 * credentials and pressing a button that could not succeed.
 */
describe('Login page: offline explanation on arrival', () => {
	const remembered = { id: 3, username: 'alice', is_admin: false, created_at: '' };

	beforeEach(() => {
		vi.mocked(readSessionUser).mockReturnValue(null);
		vi.mocked(hasUnlockPasscode).mockReturnValue(false);
		vi.stubGlobal('navigator', { ...navigator, onLine: true });
	});

	it('explains how to enable offline unlock when this device has notes but no way in', async () => {
		vi.mocked(readSessionUser).mockReturnValue(remembered);
		vi.mocked(hasUnlockPasscode).mockReturnValue(false);

		render(LoginPage);

		await waitFor(() =>
			expect(screen.getByText(/log in once here to unlock them/i)).toBeInTheDocument(),
		);
	});

	it('says plainly that logging in needs a connection when offline', async () => {
		vi.stubGlobal('navigator', { ...navigator, onLine: false });

		render(LoginPage);

		await waitFor(() => expect(screen.getByText(/you're offline/i)).toBeInTheDocument());
	});

	it('says nothing on an ordinary online visit', async () => {
		render(LoginPage);
		await new Promise((r) => setTimeout(r, 20));

		expect(screen.queryByText(/you're offline/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/log in once here to unlock/i)).not.toBeInTheDocument();
	});

	it('says nothing when this device can already unlock offline', async () => {
		vi.mocked(readSessionUser).mockReturnValue(remembered);
		vi.mocked(hasUnlockPasscode).mockReturnValue(true);

		render(LoginPage);
		await new Promise((r) => setTimeout(r, 20));

		expect(screen.queryByText(/log in once here to unlock/i)).not.toBeInTheDocument();
	});
});
