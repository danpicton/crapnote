import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SvelteMap } from 'svelte/reactivity';
import SettingsPage from './+page.svelte';

const mockApi = vi.hoisted(() => ({
	auth: { changePassword: vi.fn() },
	tokens: { list: vi.fn().mockResolvedValue([]) },
}));
const mockAuth = vi.hoisted(() => ({
	user: { id: 1, username: 'alice', is_admin: false, created_at: '' } as {
		id: number;
		username: string;
		is_admin: boolean;
		created_at: string;
	} | null,
	loading: false,
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
	auth: mockAuth,
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

vi.mock('$lib/components/MobileTabBar.svelte', () => ({
	default: (anchor: unknown, props: unknown) => { void anchor; void props; },
}));

// globalTheme is backed by a SvelteMap so the mock is reactive the way the
// real rune-based store is: theme.init() resolves its GET after mount, so a
// component reading globalTheme has to keep following it, not snapshot it.
// (A plain property would be read once and never invalidate anything.)
const themeSignals = new SvelteMap<string, string | null>();

// vi.mock is hoisted; use vi.hoisted so mockTheme is available inside the factory.
const mockTheme = vi.hoisted(() => ({
	current: 'light' as string,
	themes: [
		{ id: 'light', label: 'Light' },
		{ id: 'dark', label: 'Dark' },
		{ id: 'console-2001', label: 'Console 2001' },
		{ id: 'rosso', label: 'Rosso' },
		{ id: 'bianco', label: 'Bianco' },
		{ id: 'rawblock', label: 'Rawblock' },
		{ id: 'verdana', label: 'Verdana' },
	],
	get globalTheme(): string | null {
		return themeSignals.get('globalTheme') ?? null;
	},
	set globalTheme(value: string | null) {
		themeSignals.set('globalTheme', value);
	},
	set: vi.fn(),
	setGlobal: vi.fn(),
	toggle: vi.fn(),
	init: vi.fn(),
}));
vi.mock('$lib/stores/theme.svelte', () => ({ theme: mockTheme }));

describe('Settings page', () => {
	it('renders heading', () => {
		render(SettingsPage);
		expect(screen.getAllByRole('heading', { name: /settings/i }).length).toBeGreaterThan(0);
	});

	it('shows export notes button', () => {
		render(SettingsPage);
		expect(screen.getByRole('button', { name: /export notes/i })).toBeInTheDocument();
	});

	it('shows back link to notes', () => {
		render(SettingsPage);
		expect(screen.getAllByRole('link', { name: /back to notes/i }).length).toBeGreaterThan(0);
	});
});

// The Administration → User management link is gated on auth.user?.is_admin.
// A previous bug returned {status:"ok"} from POST /api/auth/login, so on a
// fresh login the SPA stored a user object with no is_admin field and the
// link stayed hidden until refresh. These tests guard the gate itself.
describe('Settings — Administration link', () => {
	it('shows the User management link when the user is an admin', () => {
		mockAuth.user = { id: 1, username: 'admin', is_admin: true, created_at: '' };
		render(SettingsPage);
		expect(screen.getByRole('link', { name: /user management/i })).toBeInTheDocument();
	});

	it('hides the User management link when the user is not an admin', () => {
		mockAuth.user = { id: 1, username: 'alice', is_admin: false, created_at: '' };
		render(SettingsPage);
		expect(screen.queryByRole('link', { name: /user management/i })).toBeNull();
	});

	it('hides the User management link when auth.user is null', () => {
		mockAuth.user = null;
		render(SettingsPage);
		expect(screen.queryByRole('link', { name: /user management/i })).toBeNull();
		// Restore for subsequent tests in this file that assume a logged-in user.
		mockAuth.user = { id: 1, username: 'alice', is_admin: false, created_at: '' };
	});
});

describe('Settings — Appearance', () => {
	it('shows an Appearance section heading', () => {
		render(SettingsPage);
		expect(screen.getByRole('heading', { name: /appearance/i })).toBeInTheDocument();
	});

	it('shows a theme selector', () => {
		render(SettingsPage);
		expect(screen.getByRole('combobox', { name: /theme/i })).toBeInTheDocument();
	});

	it('lists all available themes as options', () => {
		render(SettingsPage);
		const select = screen.getByRole('combobox', { name: /theme/i });
		const options = Array.from(select.querySelectorAll('option')).map((o) => o.value);
		expect(options).toEqual(['light', 'dark', 'console-2001', 'rosso', 'bianco', 'rawblock', 'verdana']);
	});

	it('selects the current theme', () => {
		mockTheme.current = 'console-2001';
		render(SettingsPage);
		const select = screen.getByRole('combobox', { name: /theme/i }) as HTMLSelectElement;
		expect(select.value).toBe('console-2001');
	});

	it('calls theme.set() with the chosen theme on change', async () => {
		mockTheme.current = 'light';
		mockTheme.set = vi.fn();
		render(SettingsPage);
		const select = screen.getByRole('combobox', { name: /^theme$/i });
		await fireEvent.change(select, { target: { value: 'console-2001' } });
		expect(mockTheme.set).toHaveBeenCalledWith('console-2001');
	});
});

describe('Settings — Global theme (admin)', () => {
	beforeEach(() => {
		mockAuth.user = { id: 1, username: 'admin', is_admin: true, created_at: '' };
		mockTheme.globalTheme = null;
		mockTheme.setGlobal = vi.fn().mockResolvedValue(undefined);
	});

	afterEach(() => {
		// Later suites assume a plain logged-in user.
		mockAuth.user = { id: 1, username: 'alice', is_admin: false, created_at: '' };
	});

	it('shows the global theme selector for admins', () => {
		render(SettingsPage);
		expect(screen.getByRole('combobox', { name: /global theme/i })).toBeInTheDocument();
	});

	it('hides the global theme selector for non-admins', () => {
		mockAuth.user = { id: 2, username: 'alice', is_admin: false, created_at: '' };
		render(SettingsPage);
		expect(screen.queryByRole('combobox', { name: /global theme/i })).toBeNull();
	});

	it('shows "Not set" when no global theme is stored', () => {
		render(SettingsPage);
		const select = screen.getByRole('combobox', { name: /global theme/i }) as HTMLSelectElement;
		expect(select.value).toBe('');
	});

	it('selects the stored global theme', () => {
		mockTheme.globalTheme = 'rosso';
		render(SettingsPage);
		const select = screen.getByRole('combobox', { name: /global theme/i }) as HTMLSelectElement;
		expect(select.value).toBe('rosso');
	});

	it('calls theme.setGlobal() with the chosen theme on change', async () => {
		render(SettingsPage);
		const select = screen.getByRole('combobox', { name: /global theme/i });
		await fireEvent.change(select, { target: { value: 'bianco' } });
		await waitFor(() => {
			expect(mockTheme.setGlobal).toHaveBeenCalledWith('bianco');
		});
	});

	// A failed save must not leave the select showing a value the server does
	// not hold: the DOM is the admin's only signal of what the global theme is.
	it('reverts the select to the stored global theme when the save fails', async () => {
		mockTheme.globalTheme = 'rosso';
		mockTheme.setGlobal = vi.fn().mockRejectedValue(new Error('boom'));
		render(SettingsPage);
		const select = screen.getByRole('combobox', { name: /global theme/i }) as HTMLSelectElement;

		await fireEvent.change(select, { target: { value: 'bianco' } });

		await waitFor(() => {
			expect(screen.getByText('Failed to save the global theme.')).toBeInTheDocument();
		});
		expect(select.value).toBe('rosso');
	});

	it('reverts the select to "Not set" when the save fails and no global theme is stored', async () => {
		mockTheme.globalTheme = null;
		mockTheme.setGlobal = vi.fn().mockRejectedValue(new Error('boom'));
		render(SettingsPage);
		const select = screen.getByRole('combobox', { name: /global theme/i }) as HTMLSelectElement;

		await fireEvent.change(select, { target: { value: 'bianco' } });

		await waitFor(() => {
			expect(screen.getByText('Failed to save the global theme.')).toBeInTheDocument();
		});
		expect(select.value).toBe('');
		expect(select.selectedOptions[0]?.textContent).toBe('Not set');
	});

	// Guards against a revert that wedges the select: the reverting assignment
	// must not stop a later pick from sticking.
	it('lets a later successful save update the select and clear the error', async () => {
		mockTheme.globalTheme = 'rosso';
		mockTheme.setGlobal = vi.fn().mockRejectedValue(new Error('boom'));
		render(SettingsPage);
		const select = screen.getByRole('combobox', { name: /global theme/i }) as HTMLSelectElement;

		await fireEvent.change(select, { target: { value: 'bianco' } });
		await waitFor(() => {
			expect(screen.getByText('Failed to save the global theme.')).toBeInTheDocument();
		});

		// Mirrors the real store, which updates globalTheme once the PUT lands.
		mockTheme.setGlobal = vi.fn().mockImplementation(async (id: string) => {
			mockTheme.globalTheme = id;
		});
		await fireEvent.change(select, { target: { value: 'verdana' } });

		await waitFor(() => {
			expect(screen.queryByText('Failed to save the global theme.')).toBeNull();
		});
		expect(mockTheme.setGlobal).toHaveBeenCalledWith('verdana');
		expect(select.value).toBe('verdana');
	});

	// theme.init() resolves its GET after mount, so the select has to keep
	// tracking the store rather than snapshotting it at mount — including
	// after a failed save has pushed a reverted value into it.
	it('follows a global theme that lands after the page has mounted', async () => {
		mockTheme.globalTheme = null;
		render(SettingsPage);
		const select = screen.getByRole('combobox', { name: /global theme/i }) as HTMLSelectElement;
		expect(select.value).toBe('');

		mockTheme.globalTheme = 'rawblock';

		await waitFor(() => {
			expect(select.value).toBe('rawblock');
		});
	});

	it('still follows the store after a failed save has reverted the select', async () => {
		mockTheme.globalTheme = 'rosso';
		mockTheme.setGlobal = vi.fn().mockRejectedValue(new Error('boom'));
		render(SettingsPage);
		const select = screen.getByRole('combobox', { name: /global theme/i }) as HTMLSelectElement;

		await fireEvent.change(select, { target: { value: 'bianco' } });
		await waitFor(() => {
			expect(select.value).toBe('rosso');
		});

		// Another admin's change arrives (or init() finally resolves).
		mockTheme.globalTheme = 'verdana';

		await waitFor(() => {
			expect(select.value).toBe('verdana');
		});
	});

	// Two saves in flight at once: only the newest may write the select or the
	// error. An older request that rejects after a newer one has succeeded must
	// not revert the admin's newer, saved pick or claim a failure for it.
	it('ignores a stale rejection that lands after a newer save succeeded', async () => {
		mockTheme.globalTheme = 'rosso';
		let rejectFirst: (err: Error) => void = () => {};
		mockTheme.setGlobal = vi.fn().mockImplementation(async (id: string) => {
			if (id === 'bianco') {
				await new Promise((_, reject) => {
					rejectFirst = reject;
				});
				return;
			}
			mockTheme.globalTheme = id;
		});
		render(SettingsPage);
		const select = screen.getByRole('combobox', { name: /global theme/i }) as HTMLSelectElement;

		await fireEvent.change(select, { target: { value: 'bianco' } });
		await fireEvent.change(select, { target: { value: 'verdana' } });
		await waitFor(() => {
			expect(select.value).toBe('verdana');
		});

		rejectFirst(new Error('boom'));
		await waitFor(() => {
			expect(mockTheme.setGlobal).toHaveBeenCalledTimes(2);
		});

		expect(select.value).toBe('verdana');
		expect(screen.queryByText('Failed to save the global theme.')).toBeNull();
	});

	// The mirror case: an older request that *succeeds* late must not clear the
	// newest attempt's error or pull the select off the newest value.
	it('ignores a stale success that lands after a newer save failed', async () => {
		mockTheme.globalTheme = 'rosso';
		let resolveFirst: () => void = () => {};
		mockTheme.setGlobal = vi.fn().mockImplementation(async (id: string) => {
			if (id === 'bianco') {
				await new Promise<void>((resolve) => {
					resolveFirst = resolve;
				});
				return;
			}
			throw new Error('boom');
		});
		render(SettingsPage);
		const select = screen.getByRole('combobox', { name: /global theme/i }) as HTMLSelectElement;

		await fireEvent.change(select, { target: { value: 'bianco' } });
		await fireEvent.change(select, { target: { value: 'verdana' } });
		await waitFor(() => {
			expect(screen.getByText('Failed to save the global theme.')).toBeInTheDocument();
		});
		expect(select.value).toBe('rosso');

		resolveFirst();
		await waitFor(() => {
			expect(mockTheme.setGlobal).toHaveBeenCalledTimes(2);
		});

		expect(screen.getByText('Failed to save the global theme.')).toBeInTheDocument();
		expect(select.value).toBe('rosso');
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

		await fireEvent.input(screen.getByLabelText('New password'), {
			target: { value: 'newpassword345' },
		});
		await fireEvent.input(screen.getByLabelText(/confirm new password/i), {
			target: { value: 'newpassword345' },
		});
		await fireEvent.click(screen.getByRole('button', { name: /update password/i }));

		await waitFor(() => {
			expect(mockApi.auth.changePassword).toHaveBeenCalledWith('newpassword345');
		});
	});

	it('rejects when the new password and confirmation differ', async () => {
		render(SettingsPage);

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

	it('rejects new passwords shorter than 12 characters client-side', async () => {
		render(SettingsPage);
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

	// Required-field UI: empty New / Confirm fields get .pw-wrap-invalid on
	// submit. The class is what the global mobile rule + PasswordInput
	// component scope key off of to paint the row red.
	it('flags both empty password fields with .pw-wrap-invalid on empty submit', async () => {
		render(SettingsPage);

		await fireEvent.click(screen.getByRole('button', { name: /update password/i }));

		const newPw = screen.getByLabelText('New password');
		const confirmPw = screen.getByLabelText(/confirm new password/i);
		await waitFor(() =>
			expect(newPw.closest('.pw-wrap')?.classList.contains('pw-wrap-invalid')).toBe(true),
		);
		expect(confirmPw.closest('.pw-wrap')?.classList.contains('pw-wrap-invalid')).toBe(true);
		expect(mockApi.auth.changePassword).not.toHaveBeenCalled();
	});
});

describe('Settings — Typemark', () => {
	it('typemark is a link to the home page', () => {
		render(SettingsPage);
		const link = screen.getByRole('link', { name: /^crapnote/i });
		expect(link).toHaveAttribute('href', '/');
	});
});
