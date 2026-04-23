import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AdminPage from './+page.svelte';

vi.mock('$lib/api', () => ({
	api: {
		auth: {
			logout: vi.fn(),
		},
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

	it('calls PUT /password when setting a new password for a user', async () => {
		window.prompt = vi.fn().mockReturnValue('new-strong-pass-1234');
		mockFetch
			.mockResolvedValueOnce(ok(mockUsers))
			.mockResolvedValueOnce({ ok: true, status: 204, json: () => Promise.resolve(null), text: () => Promise.resolve('') });

		render(AdminPage);
		await waitFor(() => screen.getByText('alice'));
		await fireEvent.click(screen.getByRole('button', { name: /set password for alice/i }));

		await waitFor(() => {
			const call = mockFetch.mock.calls.find((c) => typeof c[0] === 'string' && c[0].endsWith('/password'));
			expect(call).toBeTruthy();
			expect(call?.[1]?.method).toBe('PUT');
		});
	});

	it('calls POST /api/admin/users on create', async () => {
		mockFetch
			.mockResolvedValueOnce(ok(mockUsers)) // initial list
			.mockResolvedValueOnce(ok({ id: 3, username: 'bob', is_admin: false, created_at: '' })) // create
			.mockResolvedValueOnce(ok([...mockUsers, { id: 3, username: 'bob', is_admin: false, created_at: '' }])); // refresh

		render(AdminPage);
		await waitFor(() => screen.getByPlaceholderText(/username/i));

		await fireEvent.input(screen.getByPlaceholderText(/username/i), { target: { value: 'bob' } });
		await fireEvent.input(screen.getByPlaceholderText(/password/i), { target: { value: 'pass123' } });
		await fireEvent.click(screen.getByRole('button', { name: /create/i }));

		await waitFor(() => {
			const calls = mockFetch.mock.calls;
			const createCall = calls.find((c) => c[1]?.method === 'POST');
			expect(createCall).toBeTruthy();
		});
	});
});
