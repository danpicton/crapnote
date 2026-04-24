import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AdminPage from './+page.svelte';

const mockApi = vi.hoisted(() => ({
	auth: { logout: vi.fn() },
	admin: {
		inviteUser: vi.fn(),
		regenerateInvite: vi.fn(),
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

vi.mock('$lib/stores/auth.svelte', () => ({
	auth: {
		user: { id: 1, username: 'admin', is_admin: true, created_at: '' },
		loading: false,
	},
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

// Admin uses a separate fetch-based API not in api.ts (admin endpoints)
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function ok(data: unknown) {
	return { ok: true, status: 200, json: () => Promise.resolve(data), text: () => Promise.resolve('') };
}

const mockUsers = [
	{ id: 1, username: 'admin', is_admin: true, locked: false, created_at: '2024-01-01T00:00:00Z' },
	{ id: 2, username: 'alice', is_admin: false, locked: false, created_at: '2024-01-01T00:00:00Z' },
];

beforeEach(() => {
	vi.clearAllMocks();
	mockFetch.mockResolvedValue(ok(mockUsers));
});

describe('Admin page', () => {
	it('renders heading', async () => {
		render(AdminPage);
		await waitFor(() => {
			expect(screen.getByRole('heading', { name: /user management/i })).toBeInTheDocument();
		});
	});

	it('lists users', async () => {
		render(AdminPage);
		await waitFor(() => {
			expect(screen.getByText('alice')).toBeInTheDocument();
		});
	});

	it('shows create user form', async () => {
		render(AdminPage);
		await waitFor(() => {
			expect(screen.getByPlaceholderText(/username/i)).toBeInTheDocument();
		});
	});

	it('shows locked state for a locked user', async () => {
		mockFetch.mockResolvedValue(
			ok([
				{ id: 1, username: 'admin', is_admin: true, locked: false, created_at: '' },
				{ id: 2, username: 'alice', is_admin: false, locked: true, created_at: '' },
			])
		);
		render(AdminPage);
		await waitFor(() => {
			expect(screen.getByText('alice')).toBeInTheDocument();
		});
		expect(screen.getByRole('button', { name: /unlock/i })).toBeInTheDocument();
	});

	it('calls POST /lock when locking a user', async () => {
		mockFetch
			.mockResolvedValueOnce(ok(mockUsers))
			.mockResolvedValueOnce(ok({ id: 2, username: 'alice', is_admin: false, locked: true, created_at: '' }))
			.mockResolvedValueOnce(ok([mockUsers[0], { id: 2, username: 'alice', is_admin: false, locked: true, created_at: '' }]));

		render(AdminPage);
		await waitFor(() => screen.getByText('alice'));
		await fireEvent.click(screen.getByRole('button', { name: /lock alice/i }));

		await waitFor(() => {
			const call = mockFetch.mock.calls.find((c) => typeof c[0] === 'string' && c[0].endsWith('/lock'));
			expect(call).toBeTruthy();
		});
	});

	it('opens a modal when the Key button is clicked and calls PUT /password on submit', async () => {
		mockFetch
			.mockResolvedValueOnce(ok(mockUsers))
			.mockResolvedValueOnce({ ok: true, status: 204, json: () => Promise.resolve(null), text: () => Promise.resolve('') });

		render(AdminPage);
		await waitFor(() => screen.getByText('alice'));
		await fireEvent.click(screen.getByRole('button', { name: /set password for alice/i }));

		// Modal renders with two password fields.
		const dialog = await screen.findByRole('dialog');
		expect(dialog).toBeInTheDocument();

		await fireEvent.input(screen.getByLabelText('New password'), {
			target: { value: 'new-strong-pass-1234' },
		});
		await fireEvent.input(screen.getByLabelText('Confirm password'), {
			target: { value: 'new-strong-pass-1234' },
		});
		await fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

		await waitFor(() => {
			const call = mockFetch.mock.calls.find((c) => typeof c[0] === 'string' && c[0].endsWith('/password'));
			expect(call).toBeTruthy();
			expect(call?.[1]?.method).toBe('PUT');
		});
	});

	it('shows a mismatch error and does not call the API when passwords differ', async () => {
		mockFetch.mockResolvedValueOnce(ok(mockUsers));

		render(AdminPage);
		await waitFor(() => screen.getByText('alice'));
		await fireEvent.click(screen.getByRole('button', { name: /set password for alice/i }));

		await screen.findByRole('dialog');
		await fireEvent.input(screen.getByLabelText('New password'), {
			target: { value: 'new-strong-pass-1234' },
		});
		await fireEvent.input(screen.getByLabelText('Confirm password'), {
			target: { value: 'different-password-xyz' },
		});
		await fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

		expect(screen.getByRole('alert').textContent).toMatch(/match/i);
		// Only the initial list fetch — no PUT.
		expect(
			mockFetch.mock.calls.find((c) => typeof c[0] === 'string' && c[0].endsWith('/password'))
		).toBeFalsy();
	});

	it('calls POST /api/admin/users on create when password and confirm match', async () => {
		mockFetch
			.mockResolvedValueOnce(ok(mockUsers)) // initial list
			.mockResolvedValueOnce(ok({ id: 3, username: 'bob', is_admin: false, created_at: '' })) // create
			.mockResolvedValueOnce(ok([...mockUsers, { id: 3, username: 'bob', is_admin: false, created_at: '' }])); // refresh

		render(AdminPage);
		await waitFor(() => screen.getByPlaceholderText(/^username$/i));

		await fireEvent.input(screen.getByPlaceholderText(/^username$/i), { target: { value: 'bob' } });
		await fireEvent.input(screen.getByPlaceholderText(/^password$/i), {
			target: { value: 'correct-horse-battery' },
		});
		await fireEvent.input(screen.getByPlaceholderText(/confirm password/i), {
			target: { value: 'correct-horse-battery' },
		});
		await fireEvent.click(screen.getByRole('button', { name: /create user/i }));

		await waitFor(() => {
			const createCall = mockFetch.mock.calls.find(
				(c) => c[1]?.method === 'POST' && typeof c[0] === 'string' && c[0].endsWith('/api/admin/users'),
			);
			expect(createCall).toBeTruthy();
		});
	});

	it('switches to invite mode, hides password fields, and calls api.admin.inviteUser', async () => {
		mockApi.admin.inviteUser.mockResolvedValueOnce({
			user: { id: 5, username: 'mallory', is_admin: false, pending_setup: true, created_at: '' },
			setup_url: 'http://localhost/setup/abc123',
			expires_at: '2030-01-01T00:00:00Z',
		});
		mockFetch
			.mockResolvedValueOnce(ok(mockUsers)) // initial list
			.mockResolvedValueOnce(ok([...mockUsers, { id: 5, username: 'mallory', is_admin: false, locked: false, pending_setup: true, created_at: '' }])); // refresh

		render(AdminPage);
		await waitFor(() => screen.getByPlaceholderText(/^username$/i));

		// Switch mode.
		await fireEvent.click(screen.getByLabelText(/send setup link/i));

		// Password fields should now be gone.
		expect(screen.queryByPlaceholderText(/^password$/i)).not.toBeInTheDocument();

		await fireEvent.input(screen.getByPlaceholderText(/^username$/i), { target: { value: 'mallory' } });
		await fireEvent.click(screen.getByRole('button', { name: /^send setup link$/i }));

		await waitFor(() => {
			expect(mockApi.admin.inviteUser).toHaveBeenCalledWith('mallory', false);
		});
		// The resulting setup URL is displayed to the admin.
		expect(screen.getByText('http://localhost/setup/abc123')).toBeInTheDocument();
	});

	it('shows a mismatch error and skips create when the two password fields differ', async () => {
		mockFetch.mockResolvedValueOnce(ok(mockUsers));

		render(AdminPage);
		await waitFor(() => screen.getByPlaceholderText(/^username$/i));

		await fireEvent.input(screen.getByPlaceholderText(/^username$/i), { target: { value: 'bob' } });
		await fireEvent.input(screen.getByPlaceholderText(/^password$/i), {
			target: { value: 'correct-horse-battery' },
		});
		await fireEvent.input(screen.getByPlaceholderText(/confirm password/i), {
			target: { value: 'different-pw-1234567' },
		});
		await fireEvent.click(screen.getByRole('button', { name: /create user/i }));

		expect(screen.getByRole('alert').textContent).toMatch(/match/i);
		expect(
			mockFetch.mock.calls.find(
				(c) => c[1]?.method === 'POST' && typeof c[0] === 'string' && c[0].endsWith('/api/admin/users'),
			),
		).toBeFalsy();
	});
});
