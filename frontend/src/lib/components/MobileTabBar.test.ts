import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MobileTabBar from './MobileTabBar.svelte';

const goto = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto }));

const mockAuth = vi.hoisted(() => ({
	user: { id: 1, username: 'alice', is_admin: false },
	logout: vi.fn(),
}));
vi.mock('$lib/stores/auth.svelte', () => ({ auth: mockAuth }));

beforeEach(() => {
	vi.clearAllMocks();
	mockAuth.logout.mockResolvedValue(undefined);
});

describe('MobileTabBar', () => {
	it('marks only the active destination as the current page', () => {
		render(MobileTabBar, { activeTab: 'archive' });

		expect(screen.getByRole('link', { name: 'Archive' })).toHaveAttribute('aria-current', 'page');
		expect(screen.getByRole('link', { name: 'Notes' })).not.toHaveAttribute('aria-current');
		expect(screen.getByRole('link', { name: 'Trash' })).not.toHaveAttribute('aria-current');
		expect(screen.getByRole('link', { name: 'Settings' })).not.toHaveAttribute('aria-current');
	});

	it('asks for confirmation without signing out immediately', async () => {
		render(MobileTabBar, { activeTab: 'notes' });

		await fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

		expect(screen.getByRole('alertdialog', { name: 'Sign out confirmation' })).toHaveTextContent(
			'Sign out of alice?'
		);
		expect(mockAuth.logout).not.toHaveBeenCalled();
	});

	it('can cancel sign out', async () => {
		render(MobileTabBar, { activeTab: 'notes' });
		await fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

		expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
		expect(mockAuth.logout).not.toHaveBeenCalled();
	});

	it('signs out before navigating to login', async () => {
		const order: string[] = [];
		mockAuth.logout.mockImplementation(async () => {
			order.push('logout');
		});
		goto.mockImplementation(() => {
			order.push('goto');
		});
		render(MobileTabBar, { activeTab: 'settings' });
		await fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

		const dialog = screen.getByRole('alertdialog', { name: 'Sign out confirmation' });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Sign out' }));

		await vi.waitFor(() => expect(goto).toHaveBeenCalledWith('/login', { replaceState: true }));
		expect(mockAuth.logout).toHaveBeenCalledOnce();
		expect(order).toEqual(['logout', 'goto']);
	});
});
