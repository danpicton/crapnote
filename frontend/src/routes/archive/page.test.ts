import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ArchivePage from './+page.svelte';

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
		notes: {
			listArchived: vi.fn(),
			unarchive: vi.fn(),
			delete: vi.fn(),
		},
	},
};
});
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import { api, OfflineError } from '$lib/api';

const mockNote = (overrides = {}) => ({
	id: 1, title: 'Archived Note', body: '', starred: false, pinned: false, archived: true, locked: false,
	created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
	...overrides,
});

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(api.notes.listArchived).mockResolvedValue([mockNote()]);
	vi.stubGlobal('confirm', () => true);
});

describe('Archive page', () => {
	it('renders heading', async () => {
		render(ArchivePage);
		await waitFor(() => expect(screen.getByRole('heading', { name: /archive/i })).toBeInTheDocument());
	});

	it('renders the Crapnote wordmark linking to home', async () => {
		render(ArchivePage);
		const wordmark = screen.getByRole('link', { name: /crapnote/i });
		expect(wordmark).toBeInTheDocument();
		expect(wordmark).toHaveAttribute('href', '/');
	});

	it('navigates home on Escape key', async () => {
		const { goto } = await import('$app/navigation');
		render(ArchivePage);
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(goto).toHaveBeenCalledWith('/');
	});

	it('shows archived note titles', async () => {
		render(ArchivePage);
		await waitFor(() => expect(screen.getByText('Archived Note')).toBeInTheDocument());
	});

	it('searches archived note titles and bodies as the user types', async () => {
		vi.mocked(api.notes.listArchived)
			.mockResolvedValueOnce([mockNote(), mockNote({ id: 2, title: 'Other note' })])
			.mockResolvedValueOnce([mockNote()]);
		render(ArchivePage);
		const input = await screen.findByRole('searchbox', { name: /search archive/i });

		await fireEvent.input(input, { target: { value: 'eleph' } });

		await waitFor(() => expect(api.notes.listArchived).toHaveBeenLastCalledWith(
			{ search: 'eleph' }, expect.any(AbortSignal)
		));
	});

	it('shows no results and clearing search restores the archive', async () => {
		vi.mocked(api.notes.listArchived)
			.mockResolvedValueOnce([mockNote()])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([mockNote()]);
		render(ArchivePage);
		const input = await screen.findByRole('searchbox', { name: /search archive/i });
		await fireEvent.input(input, { target: { value: 'missing' } });
		await screen.findByText(/no archived notes match/i);

		await fireEvent.click(screen.getByRole('button', { name: /clear search/i }));

		await waitFor(() => expect(screen.getByText('Archived Note')).toBeInTheDocument());
		expect(input).toHaveValue('');
		expect(api.notes.listArchived).toHaveBeenLastCalledWith({}, expect.any(AbortSignal));
	});

	it('restores a note from filtered results', async () => {
		vi.mocked(api.notes.listArchived)
			.mockResolvedValueOnce([mockNote(), mockNote({ id: 2, title: 'Matching note' })])
			.mockResolvedValueOnce([mockNote({ id: 2, title: 'Matching note' })]);
		vi.mocked(api.notes.unarchive).mockResolvedValueOnce(undefined);
		render(ArchivePage);
		await fireEvent.input(await screen.findByRole('searchbox', { name: /search archive/i }), {
			target: { value: 'matching' },
		});
		await screen.findByText('Matching note');

		await fireEvent.click(screen.getByRole('button', { name: /restore from archive/i }));

		await waitFor(() => expect(api.notes.unarchive).toHaveBeenCalledWith(2));
	});

	it('deletes a note from filtered results', async () => {
		vi.mocked(api.notes.listArchived)
			.mockResolvedValueOnce([mockNote(), mockNote({ id: 2, title: 'Matching note' })])
			.mockResolvedValueOnce([mockNote({ id: 2, title: 'Matching note' })]);
		vi.mocked(api.notes.delete).mockResolvedValueOnce(undefined);
		render(ArchivePage);
		await fireEvent.input(await screen.findByRole('searchbox', { name: /search archive/i }), {
			target: { value: 'matching' },
		});
		await screen.findByText('Matching note');

		await fireEvent.click(screen.getByRole('button', { name: /delete permanently/i }));

		await waitFor(() => expect(api.notes.delete).toHaveBeenCalledWith(2));
	});

	it('shows empty state when archive is empty', async () => {
		vi.mocked(api.notes.listArchived).mockResolvedValue([]);
		render(ArchivePage);
		await waitFor(() => expect(screen.getByText(/archive is empty/i)).toBeInTheDocument());
	});

	it('calls unarchive on restore click', async () => {
		vi.mocked(api.notes.unarchive).mockResolvedValueOnce(undefined);
		render(ArchivePage);
		await waitFor(() => screen.getByText('Archived Note'));
		await fireEvent.click(screen.getByRole('button', { name: /restore from archive/i }));
		await waitFor(() => expect(api.notes.unarchive).toHaveBeenCalledWith(1));
	});

	it('calls delete on delete click', async () => {
		vi.mocked(api.notes.delete).mockResolvedValueOnce(undefined);
		render(ArchivePage);
		await waitFor(() => screen.getByText('Archived Note'));
		await fireEvent.click(screen.getByRole('button', { name: /delete permanently/i }));
		await waitFor(() => expect(api.notes.delete).toHaveBeenCalledWith(1));
	});
});

describe('Locked archived notes', () => {
	it('refuses to delete a locked note and says why', async () => {
		vi.mocked(api.notes.listArchived).mockResolvedValue([mockNote({ locked: true })]);
		const alerts: string[] = [];
		vi.stubGlobal('alert', (m: string) => alerts.push(m));

		render(ArchivePage);
		await waitFor(() => screen.getByText('Archived Note'));

		await fireEvent.click(screen.getByTitle('Delete permanently'));

		expect(api.notes.delete).not.toHaveBeenCalled();
		expect(alerts.join(' ')).toMatch(/locked/i);
	});

	it('still deletes an unlocked note', async () => {
		render(ArchivePage);
		await waitFor(() => screen.getByText('Archived Note'));

		await fireEvent.click(screen.getByTitle('Delete permanently'));

		await waitFor(() => expect(api.notes.delete).toHaveBeenCalledWith(1));
	});
});

describe('Archive page offline', () => {
	it('shows an offline notice instead of spinning when the fetch fails offline', async () => {
		vi.mocked(api.notes.listArchived).mockRejectedValue(new OfflineError());

		render(ArchivePage);

		await waitFor(() =>
			expect(screen.getByText(/aren't available offline/i)).toBeInTheDocument()
		);
		expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
	});

	it('a genuine server failure shows an error, not a misleading offline notice', async () => {
		vi.mocked(api.notes.listArchived).mockRejectedValue(new Error('boom'));

		render(ArchivePage);

		await waitFor(() =>
			expect(screen.getByText(/couldn't load archived notes/i)).toBeInTheDocument()
		);
		expect(screen.queryByText(/aren't available offline/i)).not.toBeInTheDocument();
	});
});
