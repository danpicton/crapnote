import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TrashPage from './+page.svelte';

vi.mock('$lib/api', () => {
	class ApiError extends Error {
		constructor(public readonly status: number, message: string) { super(message); this.name = 'ApiError'; }
	}
	class OfflineError extends ApiError {
		constructor(message = 'offline') { super(503, message); this.name = 'OfflineError'; }
	}
	return {
	ApiError,
	OfflineError,
	api: {
		trash: {
			list: vi.fn(),
			restore: vi.fn(),
			deleteOne: vi.fn(),
			empty: vi.fn(),
		},
	},
};
});

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import { api, OfflineError } from '$lib/api';

const mockEntry = (overrides = {}) => ({
	note_id: 1,
	title: 'Deleted Note',
	deleted_at: '2024-01-01T00:00:00Z',
	permanent_delete_at: '2024-01-08T00:00:00Z',
	...overrides,
});

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(api.trash.list).mockResolvedValue([mockEntry()]);
});

describe('Trash page', () => {
	it('renders heading', async () => {
		render(TrashPage);
		await waitFor(() => {
			expect(screen.getByRole('heading', { name: /trash/i })).toBeInTheDocument();
		});
	});

	it('shows trashed note titles', async () => {
		render(TrashPage);
		await waitFor(() => {
			expect(screen.getByText('Deleted Note')).toBeInTheDocument();
		});
	});

	it('shows empty trash button', async () => {
		render(TrashPage);
		await waitFor(() => {
			expect(screen.getByRole('button', { name: /empty trash/i })).toBeInTheDocument();
		});
	});

	it('calls restore on restore button click', async () => {
		vi.mocked(api.trash.restore).mockResolvedValueOnce(undefined);
		// list already mocked in beforeEach to return [mockEntry()]
		render(TrashPage);

		await waitFor(() => screen.getByText('Deleted Note'));
		await fireEvent.click(screen.getByRole('button', { name: /restore/i }));

		await waitFor(() => {
			expect(api.trash.restore).toHaveBeenCalledWith(1);
		});
	});

	it('calls empty on empty trash button', async () => {
		vi.stubGlobal('confirm', () => true);
		vi.mocked(api.trash.empty).mockResolvedValueOnce(undefined);
		vi.mocked(api.trash.list).mockResolvedValue([]);
		render(TrashPage);

		await waitFor(() => screen.getByRole('button', { name: /empty trash/i }));
		await fireEvent.click(screen.getByRole('button', { name: /empty trash/i }));

		await waitFor(() => {
			expect(api.trash.empty).toHaveBeenCalled();
		});
		vi.unstubAllGlobals();
	});

	it('shows empty state when trash is empty', async () => {
		vi.mocked(api.trash.list).mockResolvedValue([]);
		render(TrashPage);

		await waitFor(() => {
			expect(screen.getByText(/trash is empty/i)).toBeInTheDocument();
		});
	});
});

describe('Trash page offline', () => {
	it('shows an offline notice instead of spinning when the fetch fails offline', async () => {
		vi.mocked(api.trash.list).mockRejectedValue(new OfflineError());

		render(TrashPage);

		await waitFor(() =>
			expect(screen.getByText(/isn't available offline/i)).toBeInTheDocument()
		);
		expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
	});

	it('a genuine server failure shows an error, not a misleading offline notice', async () => {
		vi.mocked(api.trash.list).mockRejectedValue(new Error('boom'));

		render(TrashPage);

		await waitFor(() =>
			expect(screen.getByText(/couldn't load the trash/i)).toBeInTheDocument()
		);
		expect(screen.queryByText(/isn't available offline/i)).not.toBeInTheDocument();
	});
});

describe('trash navigation', () => {
	it('shows the mobile tab bar with Trash as the current tab', async () => {
		render(TrashPage);

		const tab = await screen.findByRole('link', { name: 'Trash' });
		expect(tab.getAttribute('href')).toBe('/trash');
		expect(tab.getAttribute('aria-current')).toBe('page');
	});

	it('offers the other tabs alongside it', async () => {
		render(TrashPage);

		expect((await screen.findByRole('link', { name: 'Notes' })).getAttribute('href')).toBe('/');
		expect((await screen.findByRole('link', { name: 'Archive' })).getAttribute('href')).toBe(
			'/archive'
		);
	});
});
