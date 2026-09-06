import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tick } from 'svelte';
import { goto } from '$app/navigation';
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

type MockUser = { id: number; username: string; is_admin: boolean; created_at: string };

// Mutable so the guard tests can model a full page load: auth is still
// loading when the page mounts and settles a tick later.
const mockAuth = vi.hoisted(() => ({
	user: null as MockUser | null,
	loading: true,
	ready: vi.fn(() => Promise.resolve()),
}));
vi.mock('$lib/stores/auth.svelte', () => ({ auth: mockAuth }));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

vi.mock('$lib/components/MobileTabBar.svelte', () => ({
	default: (anchor: unknown, props: unknown) => { void anchor; void props; },
}));

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

const adminUser: MockUser = { id: 1, username: 'admin', is_admin: true, created_at: '' };
const plainUser: MockUser = { id: 2, username: 'alice', is_admin: false, created_at: '' };

beforeEach(() => {
	vi.clearAllMocks();
	// Default: the session is already loaded and belongs to an admin, i.e.
	// client-side navigation from Settings.
	mockAuth.user = adminUser;
	mockAuth.loading = false;
	mockAuth.ready.mockImplementation(() => Promise.resolve());
	mockFetch.mockResolvedValue(ok(mockUsers));
});

describe('Admin page', () => {
	it('renders heading', async () => {
		render(AdminPage);
		await waitFor(() => {
			expect(screen.getAllByRole('heading', { name: /user management/i }).length).toBeGreaterThan(0);
		});
	});

	it('lists users', async () => {
		render(AdminPage);
		await waitFor(() => {
			expect(screen.getAllByText('alice').length).toBeGreaterThan(0);
		});
	});

	it('shows create user form', async () => {
		render(AdminPage);
		await waitFor(() => {
			expect(screen.getByPlaceholderText(/username/i)).toBeInTheDocument();
		});
	});

	it('shows active automatic cool-downs alongside the account status', async () => {
		mockFetch.mockResolvedValue(
			ok([
				{ id: 1, username: 'admin', is_admin: true, locked: false, created_at: '' },
				{ id: 2, username: 'alice', is_admin: false, locked: false, active_cooldowns: 3, created_at: '' },
			])
		);
		render(AdminPage);
		await waitFor(() => {
			expect(screen.getAllByText('alice').length).toBeGreaterThan(0);
		});
		// The account itself is not locked — the cool-down is its own signal.
		expect(screen.getAllByTitle(/3 addresses? .*cool-down/i).length).toBeGreaterThan(0);
		expect(screen.getAllByText(/cooling down \(3\)/i).length).toBeGreaterThan(0);
		expect(screen.queryByText('Locked')).not.toBeInTheDocument();
	});

	it('clears a cool-down without locking the account first', async () => {
		const cooling = { id: 2, username: 'alice', is_admin: false, locked: false, active_cooldowns: 2, created_at: '' };
		const cleared = { ...cooling, active_cooldowns: 0 };
		mockFetch
			.mockResolvedValueOnce(ok([mockUsers[0], cooling]))
			.mockResolvedValueOnce(ok(cleared));

		render(AdminPage);
		await waitFor(() => screen.getAllByText('alice'));
		await fireEvent.click(screen.getAllByRole('button', { name: /clear cool-down for alice/i })[0]);

		await waitFor(() => {
			const call = mockFetch.mock.calls.find((c) => typeof c[0] === 'string' && c[0].endsWith('/2/unlock'));
			expect(call).toBeTruthy();
		});
		// Never locks on the way, which would revoke the user's sessions.
		expect(mockFetch.mock.calls.some((c) => typeof c[0] === 'string' && c[0].endsWith('/lock'))).toBe(false);
		await waitFor(() => expect(screen.queryByText(/cooling down/i)).not.toBeInTheDocument());
	});

	it('lets an admin clear a cool-down on their own account', async () => {
		mockFetch.mockResolvedValue(
			ok([
				{ id: 1, username: 'admin', is_admin: true, locked: false, active_cooldowns: 1, created_at: '' },
				mockUsers[1],
			])
		);
		render(AdminPage);
		await waitFor(() => screen.getAllByText('admin'));
		expect(screen.getAllByRole('button', { name: /clear cool-down for admin/i }).length).toBeGreaterThan(0);
		// Still no lock or delete action against yourself.
		expect(screen.queryByRole('button', { name: /lock admin/i })).not.toBeInTheDocument();
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
			expect(screen.getAllByText('alice').length).toBeGreaterThan(0);
		});
		expect(screen.getByRole('button', { name: /unlock/i })).toBeInTheDocument();
	});

	it('calls POST /lock when locking a user', async () => {
		mockFetch
			.mockResolvedValueOnce(ok(mockUsers))
			.mockResolvedValueOnce(ok({ id: 2, username: 'alice', is_admin: false, locked: true, created_at: '' }))
			.mockResolvedValueOnce(ok([mockUsers[0], { id: 2, username: 'alice', is_admin: false, locked: true, created_at: '' }]));

		render(AdminPage);
		await waitFor(() => screen.getAllByText('alice'));
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
		await waitFor(() => screen.getAllByText('alice'));
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
		await waitFor(() => screen.getAllByText('alice'));
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

		// Switch mode. Anchored: the per-user "Send setup link to <name>"
		// buttons in the table match a looser pattern.
		await fireEvent.click(screen.getByLabelText(/^send setup link$/i));

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

	// Required-field UI: empty fields get .field-invalid / .pw-wrap-invalid
	// classes on submit (rendered as a 2px danger border + light red tint).
	// Cleared on the next input event. The class wiring was previously
	// inconsistent — the username row in particular silently failed.
	it('flags every empty required field with the invalid class on empty submit', async () => {
		mockFetch.mockResolvedValueOnce(ok(mockUsers));
		render(AdminPage);
		await waitFor(() => screen.getByPlaceholderText(/^username$/i));

		await fireEvent.click(screen.getByRole('button', { name: /create user/i }));

		const username = screen.getByPlaceholderText(/^username$/i);
		await waitFor(() => expect(username.classList.contains('field-invalid')).toBe(true));
		const password = screen.getByPlaceholderText(/^password$/i);
		const passwordWrap = password.closest('.pw-wrap');
		expect(passwordWrap?.classList.contains('pw-wrap-invalid')).toBe(true);
		const confirm = screen.getByPlaceholderText(/confirm password/i);
		const confirmWrap = confirm.closest('.pw-wrap');
		expect(confirmWrap?.classList.contains('pw-wrap-invalid')).toBe(true);

		// And nothing was sent to the server.
		expect(
			mockFetch.mock.calls.find(
				(c) => c[1]?.method === 'POST' && typeof c[0] === 'string' && c[0].endsWith('/api/admin/users'),
			),
		).toBeFalsy();
	});

	it('clears the invalid class on the next input event for a flagged field', async () => {
		mockFetch.mockResolvedValueOnce(ok(mockUsers));
		render(AdminPage);
		await waitFor(() => screen.getByPlaceholderText(/^username$/i));

		await fireEvent.click(screen.getByRole('button', { name: /create user/i }));
		const username = screen.getByPlaceholderText(/^username$/i);
		await waitFor(() => expect(username.classList.contains('field-invalid')).toBe(true));

		await fireEvent.input(username, { target: { value: 'a' } });
		await waitFor(() => expect(username.classList.contains('field-invalid')).toBe(false));
	});
});

describe('Admin — Typemark', () => {
	it('typemark is a link to the home page', async () => {
		render(AdminPage);
		await waitFor(() => screen.getAllByRole('heading', { name: /user management/i }));
		const link = screen.getByRole('link', { name: /^crapnote/i });
		expect(link).toHaveAttribute('href', '/');
	});
});

describe('Admin page — route guard', () => {
	// The root layout renders children immediately and only awaits
	// auth.init() in its own onMount, which runs after this page's. So on a
	// full page load the session is still unresolved at mount time; the guard
	// has to wait for auth.ready() before deciding anything.
	function pendingAuth(settleAs: MockUser | null) {
		let settle!: () => void;
		mockAuth.user = null;
		mockAuth.loading = true;
		mockAuth.ready.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					settle = () => {
						mockAuth.user = settleAs;
						mockAuth.loading = false;
						resolve();
					};
				})
		);
		return () => settle();
	}

	async function flush() {
		await tick();
		await new Promise((r) => setTimeout(r, 0));
		await tick();
	}

	it('waits for auth to settle before deciding, then loads the user list', async () => {
		const settle = pendingAuth(adminUser);

		render(AdminPage);
		await flush();

		// Nothing decided, nothing fetched, nothing shown yet.
		expect(goto).not.toHaveBeenCalled();
		expect(mockFetch).not.toHaveBeenCalled();
		expect(screen.queryByRole('heading', { name: /user management/i })).toBeNull();

		settle();

		await waitFor(() => {
			expect(screen.getAllByText('alice').length).toBeGreaterThan(0);
		});
		expect(goto).not.toHaveBeenCalled();
		expect(mockFetch).toHaveBeenCalledWith('/api/admin/users', { credentials: 'include' });
	});

	it('redirects a non-admin to / without fetching or rendering anything', async () => {
		const settle = pendingAuth(plainUser);

		render(AdminPage);
		settle();
		await waitFor(() => {
			expect(goto).toHaveBeenCalledWith('/');
		});

		expect(mockFetch).not.toHaveBeenCalled();
		expect(screen.queryByRole('heading', { name: /user management/i })).toBeNull();
	});

	it('leaves a logged-out visitor to the root layout (no bounce to /)', async () => {
		const settle = pendingAuth(null);

		render(AdminPage);
		settle();
		await flush();

		// The root layout sends unauthenticated visitors to /login; redirecting
		// to / from here would race it and land them on the wrong page.
		expect(goto).not.toHaveBeenCalled();
		expect(mockFetch).not.toHaveBeenCalled();
		expect(screen.queryByRole('heading', { name: /user management/i })).toBeNull();
	});

	it('still works for an admin arriving by client-side navigation', async () => {
		// auth already settled before this page mounted.
		mockAuth.user = adminUser;
		mockAuth.loading = false;

		render(AdminPage);

		await waitFor(() => {
			expect(screen.getAllByText('alice').length).toBeGreaterThan(0);
		});
		expect(goto).not.toHaveBeenCalled();
	});
});
