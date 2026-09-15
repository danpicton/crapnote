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

	it('searches deleted note titles and bodies as the user types', async () => {
		vi.mocked(api.trash.list)
			.mockResolvedValueOnce([mockEntry(), mockEntry({ note_id: 2, title: 'Other note' })])
			.mockResolvedValueOnce([mockEntry()]);
		render(TrashPage);
		const input = await screen.findByRole('searchbox', { name: /search trash/i });

		await fireEvent.input(input, { target: { value: 'eleph' } });

		await waitFor(() => expect(api.trash.list).toHaveBeenLastCalledWith(
			{ search: 'eleph' }, expect.any(AbortSignal)
		));
	});

	it('shows no results and clearing search restores the trash', async () => {
		vi.mocked(api.trash.list)
			.mockResolvedValueOnce([mockEntry()])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([mockEntry()]);
		render(TrashPage);
		const input = await screen.findByRole('searchbox', { name: /search trash/i });
		await fireEvent.input(input, { target: { value: 'missing' } });
		await screen.findByText(/no deleted notes match/i);

		await fireEvent.click(screen.getByRole('button', { name: /clear search/i }));

		await waitFor(() => expect(screen.getByText('Deleted Note')).toBeInTheDocument());
		expect(input).toHaveValue('');
		expect(api.trash.list).toHaveBeenLastCalledWith({}, expect.any(AbortSignal));
	});

	it('restores a note from filtered results', async () => {
		vi.mocked(api.trash.list)
			.mockResolvedValueOnce([mockEntry(), mockEntry({ note_id: 2, title: 'Matching note' })])
			.mockResolvedValueOnce([mockEntry({ note_id: 2, title: 'Matching note' })]);
		vi.mocked(api.trash.restore).mockResolvedValueOnce(undefined);
		render(TrashPage);
		await fireEvent.input(await screen.findByRole('searchbox', { name: /search trash/i }), {
			target: { value: 'matching' },
		});
		await screen.findByText('Matching note');

		await fireEvent.click(screen.getByRole('button', { name: /restore note/i }));

		await waitFor(() => expect(api.trash.restore).toHaveBeenCalledWith(2));
	});

	it('permanently deletes a note from filtered results', async () => {
		vi.mocked(api.trash.list)
			.mockResolvedValueOnce([mockEntry(), mockEntry({ note_id: 2, title: 'Matching note' })])
			.mockResolvedValueOnce([mockEntry({ note_id: 2, title: 'Matching note' })]);
		vi.mocked(api.trash.deleteOne).mockResolvedValueOnce(undefined);
		render(TrashPage);
		await fireEvent.input(await screen.findByRole('searchbox', { name: /search trash/i }), {
			target: { value: 'matching' },
		});
		await screen.findByText('Matching note');

		await fireEvent.click(screen.getByRole('button', { name: /delete permanently/i }));

		await waitFor(() => expect(api.trash.deleteOne).toHaveBeenCalledWith(2));
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
